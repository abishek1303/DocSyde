import "server-only";
import { observe, observePreview, type RuntimeObserver } from "./runtime-observation";
import { reliabilityContext, ReliabilityIsolationError, type ReliabilityRuntimeIdentity } from "@/integrations/reliability/execution-context";
import { reliabilityBrowserOptions } from "@/integrations/reliability/subprocess-environment";
import { closeBrowserWithin } from "@/integrations/reliability/process-ownership";
import { verifyRuntimeIdentity } from "@/integrations/reliability/runtime-identity";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { chromium, type Page } from "playwright";
import { parseHostContext } from "@/sdk/context-client";
import type { ArtifactStorage } from "@/integrations/storage/artifact-storage";
import { captureOrigin, executeCaptureStep } from "./capture";
import { redactRuntimeText, runtimePath, runtimeCredentialPatterns } from "./runtime-redaction";
import { runtimeWorkflowSchema, runtimeTraceSchema, type RuntimeTrace, type RuntimeSnapshot, type RuntimeWorkflowInput } from "./runtime-trace";

function hash(bytes: string | Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }

export async function runtimeCaptureAvailable() {
  try { await access(chromium.executablePath(), constants.X_OK); return true; }
  catch { return false; }
}

/** One caller-scripted session. No model or product interpretation lives here. */
export async function captureRuntimeTrace(raw: RuntimeWorkflowInput, storage: ArtifactStorage, signal?: AbortSignal, fixtureIdentity?: ReliabilityRuntimeIdentity, observer?: RuntimeObserver): Promise<RuntimeTrace> {
  const options = runtimeWorkflowSchema.parse(raw);
  const experiment = reliabilityContext();
  if (experiment) {
    if (process.env.DOCSYDE_RELIABILITY_CONTRACT_TEST === "1" || !["offline", "scenario"].includes(experiment.mode)) throw new ReliabilityIsolationError("offline-live-capture");
    const identity = experiment.runtimeIdentity ?? fixtureIdentity;
    if (!identity || identity.scenario !== experiment.scenario || identity.requestDeskSha !== experiment.requestDeskSha
      || identity.docsydeSha !== experiment.docsydeSha || identity.experimentId !== experiment.experimentId) throw new ReliabilityIsolationError("capture-runtime");
    await verifyRuntimeIdentity(options.baseUrl, identity);
  }
  const base = captureOrigin(options.baseUrl), target = new URL(options.path, base);
  if (target.origin !== base.origin) throw new Error("Workflow must remain on the configured origin.");
  signal?.throwIfAborted();
  const secrets = [...options.secrets, ...options.steps.flatMap(step => step.type === "fill" || step.type === "select" ? [step.value] : [])];
  const clean = (value: string, limit = 500) => redactRuntimeText(value, secrets, limit);
  const trace: RuntimeTrace = {
    version: 1, traceId: randomUUID(), status: "completed", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    requestedPathname: runtimePath(target.href, secrets), viewport: options.viewport, events: [], states: [], checkpoints: [],
    coverage: { stateBoundaries: 0, omittedStates: 0, omittedCheckpoints: 0, truncatedSnapshots: 0, pageErrors: 0, dismissedDialogs: 0, navigationStatus: null },
  };
  const pending = new Map<string, Buffer>();
  let totalBytes = 0;
  const controller = AbortSignal.any([AbortSignal.timeout(options.limits.timeoutMs), ...(signal ? [signal] : [])]);
  const browser = await chromium.launch(experiment ? await reliabilityBrowserOptions(experiment) : {});
  const abort = () => { void browser.close().catch(() => {}); };
  controller.addEventListener("abort", abort, { once: true });
  let page: Page;
  try {
    controller.throwIfAborted();
    const context = await browser.newContext({ viewport: options.viewport, deviceScaleFactor: 1, reducedMotion: "reduce", serviceWorkers: "block" });
    await context.route("**/*", async route => {
      if ((route.request().isNavigationRequest() || experiment?.mode === "offline") && new URL(route.request().url()).origin !== base.origin) await route.abort();
      else await route.continue();
    });
    page = await context.newPage();
    page.setDefaultTimeout(30_000); page.setDefaultNavigationTimeout(30_000);
    page.on("pageerror", () => { trace.coverage.pageErrors = Math.min(1000, trace.coverage.pageErrors + 1); });
    // Native dialogs are not page pixels. Never retain their messages or values.
    page.on("dialog", dialog => { trace.coverage.dismissedDialogs = Math.min(1000, trace.coverage.dismissedDialogs + 1); void dialog.dismiss().catch(() => {}); });
    observe(observer, { kind: "navigation-started", phase: "browser" });
    const response = await page.goto(target.href, { waitUntil: "domcontentloaded" });
    if (!response?.ok()) throw new Error("Navigation failed.");
    trace.coverage.navigationStatus = response.status();
    observe(observer, { kind: "navigation-completed", phase: "browser" });
    if (options.readySelector) await page.locator(options.readySelector).waitFor({ state: "visible" });

    async function boundary(trigger: RuntimeTrace["states"][number]["trigger"], actionIndex: number | null) {
      controller.throwIfAborted();
      if (new URL(page.url()).origin !== base.origin) throw new Error("Workflow left its origin.");
      trace.coverage.stateBoundaries++;
      const marker = `data-docsyde-mask-${randomUUID()}`;
      let maskReady = true;
      let marked = false;
      // Fail closed for unresolved required masks; the workflow can still finish.
      try {
        for (const selector of options.sensitiveSelectors) {
          const locator = page.locator(selector);
          if (await locator.count() === 0) maskReady = false;
          await locator.evaluateAll((elements, attr) => elements.forEach(el => el.setAttribute(attr, "")), marker);
        }
        await page.locator("input,textarea,select,[contenteditable]:not([contenteditable=false]),iframe,canvas,video").evaluateAll(
          (elements, attr) => elements.forEach(el => el.setAttribute(attr, "")), marker);
        const inspected = await page.evaluate(({ marker, secrets, patterns }) => {
          const elements = document.querySelectorAll("body *");
          // Unknown/uninspected content cannot become eligible pixels.
          const complete = elements.length <= 5000;
          for (const el of Array.from(elements).slice(0, 5000)) {
            const text = el.childElementCount === 0 ? el.textContent ?? "" : "";
            if (el.shadowRoot || secrets.some(secret => secret && text.includes(secret))
              || patterns.some(pattern => new RegExp(pattern, "i").test(text))) el.setAttribute(marker, "");
          }
          return complete;
        }, { marker, secrets, patterns: runtimeCredentialPatterns.map(pattern => pattern.source) });
        maskReady &&= inspected;
        marked = true;
      } catch { maskReady = false; }

      let snapshot: RuntimeSnapshot;
      try {
        const sampled = await page.evaluate(({ marker, regions }) => {
          let truncated = false;
          const editable = "input,textarea,select,[contenteditable]:not([contenteditable=false])";
          const excluded = `script,style,noscript,template,${editable},[${marker}]`;
          // Method syntax keeps this browser function self-contained under tsx's
          // keepNames transform (named local arrow functions inject __name).
          const helpers = { visible(el: Element) {
            const style = getComputedStyle(el);
            return style.display !== "none" && style.visibility !== "hidden" && el.getClientRects().length > 0 && !el.closest('[hidden],[aria-hidden="true"]');
          }, read(root: Element, limit: number) {
            if (root.closest(excluded) || !visible(root)) return "";
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let value = "", visited = 0, node: Node | null;
            while ((node = walker.nextNode())) {
              if (++visited > 5000) { truncated = true; break; }
              const parent = node.parentElement;
              if (parent && !parent.closest(excluded) && visible(parent)) value += `${node.textContent ?? ""} `;
              if (value.length > limit) { truncated = true; break; }
            }
            return value.slice(0, limit);
          }, take<T>(items: T[], limit: number) { if (items.length > limit) truncated = true; return items.slice(0, limit); } };
          const { visible, read, take } = helpers;
          const controls = take(Array.from(document.querySelectorAll('input,textarea,select,button,[role="tab"],[role="button"],[aria-expanded]')).filter(visible), 60)
            .filter(el => !el.closest(`[${marker}]:not(${editable})`))
            .map(el => {
              const input = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? el : null;
              const name = el.getAttribute("aria-label") ?? (input?.labels ? Array.from(input.labels).map(label => read(label, 200)).join(" ") : read(el, 200));
              return { role: (el.getAttribute("role") ?? el.tagName.toLowerCase()).slice(0, 50), name: name.slice(0, 200),
                populated: input ? Boolean(input.value) : null,
                checked: el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type) ? el.checked : null,
                selected: el.hasAttribute("aria-selected") ? el.getAttribute("aria-selected") === "true" : null,
                expanded: el.hasAttribute("aria-expanded") ? el.getAttribute("aria-expanded") === "true" : null };
            });
          return { headings: take(Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).filter(visible), 20).map(el => read(el, 300)),
            text: document.body ? read(document.body, 4000) : "",
            regions: regions.map(region => ({ name: region.name, text: (() => { const el = document.querySelector(region.selector); return el ? read(el, 2000) : ""; })() })),
            controls, overlays: take(Array.from(document.querySelectorAll('dialog[open],[role="dialog"],[role="menu"],[role="tabpanel"]')).filter(visible), 10).map(el => read(el, 300)), truncated };
        }, { marker, regions: options.regions });
        let hostContext: RuntimeSnapshot["hostContext"] = null;
        const metadata = await page.locator("script#docsyde-context[type='application/json']").first().textContent({ timeout: 100 }).catch(() => null);
        if (metadata && metadata.length < 4096) {
          try {
            const host = parseHostContext(JSON.parse(metadata));
            hostContext = { applicationId: clean(host.applicationId, 100), route: runtimePath(host.route, secrets), featureIds: host.featureIds.slice(0, 10).map(id => clean(id, 100)) };
          } catch { /* Invalid metadata is not evidence. */ }
        }
        snapshot = { ...sampled, pathname: runtimePath(page.url(), secrets), headings: sampled.headings.map(value => clean(value, 300)),
          text: clean(sampled.text, 4000), regions: sampled.regions.map(region => ({ name: clean(region.name, 100), text: clean(region.text, 2000) })),
          controls: sampled.controls.map(control => ({ ...control, role: clean(control.role, 50), name: clean(control.name, 200) })),
          overlays: sampled.overlays.map(value => clean(value, 300)), hostContext };
        if (!maskReady || !marked) {
          // Do not retain text when required exclusion could not be established.
          snapshot = { ...snapshot, text: "", headings: [], regions: [], controls: [], overlays: [], hostContext: null, truncated: true };
        }
        if (snapshot.truncated) trace.coverage.truncatedSnapshots++;
        const fingerprint = hash(JSON.stringify(snapshot));
        const previous = trace.states.at(-1);
        let state = previous?.fingerprint === fingerprint ? previous : undefined;
        if (state) state.occurrences++;
        else if (trace.states.length < options.limits.maxStates) {
          const effects = previous ? (["pathname", "text", "controls", "overlays", "hostContext", "regions"] as const)
            .filter(key => JSON.stringify(previous.snapshot[key]) !== JSON.stringify(snapshot[key])).map(key => `${key} changed`) : ["Initial ready state"];
          state = { stateId: randomUUID(), order: trace.coverage.stateBoundaries - 1, at: new Date().toISOString(), trigger, actionIndex, occurrences: 1, effects, fingerprint, snapshot };
          trace.states.push(state);
        } else trace.coverage.omittedStates++;
        // A completed action means Playwright resolved, never proof of product
        // success. Keep only bounded event metadata; summary models see states.
        trace.events.push({ order: trace.coverage.stateBoundaries - 1, at: new Date().toISOString(), trigger, actionIndex, stateId: state?.stateId ?? null });

        observe(observer, { kind: "state-captured", phase: "browser", stateId: state?.stateId ?? null, pathname: runtimePath(snapshot.pathname, secrets).slice(0, 512) });

        // Fills contribute populated state, but never cause per-edit screenshots.
        if (!state || trigger === "fill" || (state === previous && trigger !== "checkpoint" && trace.checkpoints.some(cp => cp.stateId === state.stateId))) return;
        if (trace.checkpoints.length >= options.limits.maxCheckpoints) { trace.coverage.omittedCheckpoints++; return; }
        const checkpoint: RuntimeTrace["checkpoints"][number] = { captureId: randomUUID(), stateId: state.stateId, capturedAt: new Date().toISOString(), crop: null, screenshot: null, eligible: false, limitation: "masking-failed" };
        trace.checkpoints.push(checkpoint);
        if (!maskReady || !marked) { observe(observer, { kind: "checkpoint-created", phase: "browser", captureId: checkpoint.captureId, eligible: false, limitation: "masking-failed" }); return; }
        try {
          if (options.screenshotRegion) {
            const bounds = await page.locator(options.screenshotRegion).boundingBox();
            if (!bounds || bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0
              || bounds.x + bounds.width > options.viewport.width || bounds.y + bounds.height > options.viewport.height) throw new Error("Crop is not inside the viewport.");
            checkpoint.crop = bounds;
          }
          const png = await page.screenshot({ type: "png", animations: "disabled", clip: checkpoint.crop ?? undefined,
            mask: [page.locator(`[${marker}]`)], maskColor: "#000000" });
          const sha256 = hash(png);
          if (png.byteLength > 10 * 1024 * 1024 || (!pending.has(sha256) && totalBytes + png.byteLength > options.limits.maxScreenshotBytes)) { checkpoint.limitation = "image-budget"; observe(observer, { kind: "checkpoint-created", phase: "browser", captureId: checkpoint.captureId, eligible: false, limitation: "image-budget" }); return; }
          if (!pending.has(sha256)) { pending.set(sha256, png); totalBytes += png.byteLength; }
          checkpoint.screenshot = { artifactKey: randomUUID(), mimeType: "image/png", sha256 };
          checkpoint.eligible = true; checkpoint.limitation = null;
          observePreview(observer, checkpoint.captureId, png);
        } catch { checkpoint.limitation = "screenshot-failed"; }
        observe(observer, { kind: "checkpoint-created", phase: "browser", captureId: checkpoint.captureId, eligible: checkpoint.eligible, limitation: checkpoint.limitation });
      } finally {
        await page.locator(`[${marker}]`).evaluateAll((elements, attr) => elements.forEach(el => el.removeAttribute(attr)), marker).catch(() => {});
      }
    }

    await boundary("initial", null);
    for (const [index, step] of options.steps.entries()) {
      controller.throwIfAborted();
      observe(observer, { kind: "action-started", phase: "browser", action: step.type, actionIndex: index });
      if (step.type !== "checkpoint") await executeCaptureStep(page, step);
      observe(observer, { kind: "action-completed", phase: "browser", action: step.type, actionIndex: index });
      await boundary(step.type, index);
    }
    await boundary("final", null);
    controller.throwIfAborted();
  } catch {
    throw new Error(controller.aborted ? "Runtime workflow cancelled or timed out." : "Runtime workflow failed; check readiness, selectors and local application.");
  } finally {
    controller.removeEventListener("abort", abort);
    if (experiment) await closeBrowserWithin(browser); else await browser.close();
  }
  controller.throwIfAborted();
  // Match final-capture semantics: cleanup precedes storage; failures never infer.
  const artifacts = new Map<string, string>();
  for (const [sha256, png] of pending) { controller.throwIfAborted(); artifacts.set(sha256, (await storage.store(png)).key); }
  for (const cp of trace.checkpoints) if (cp.screenshot) cp.screenshot.artifactKey = artifacts.get(cp.screenshot.sha256)!;
  controller.throwIfAborted();
  trace.finishedAt = new Date().toISOString();
  return runtimeTraceSchema.parse(trace);
}
