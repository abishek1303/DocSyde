import "server-only";
import { chromium } from "playwright";
import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseHostContext, type HostContext } from "@/sdk/context-client";
const step = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), selector: z.string().min(1) }).strict(),
  z.object({ type: z.literal("fill"), selector: z.string().min(1), value: z.string() }).strict(),
  z.object({ type: z.literal("select"), selector: z.string().min(1), value: z.string() }).strict(),
  z.object({ type: z.literal("check"), selector: z.string().min(1), checked: z.boolean() }).strict(),
  z.object({ type: z.literal("waitFor"), selector: z.string().min(1) }).strict(),
]);
const captureInput = z.object({ baseUrl: z.string().url(), path: z.string().default("/"), steps: z.array(step).max(100).default([]),
  readySelector: z.string().optional(), regions: z.array(z.object({ name: z.string(), selector: z.string() })).max(50).default([]),
  viewport: z.object({ width: z.number().int().min(1).max(3840), height: z.number().int().min(1).max(2160) }).default({ width: 1440, height: 900 }),
  outputDirectory: z.string().default(".artifacts/captures"),
}).strict();
export type CaptureInput = z.input<typeof captureInput>;
export type CaptureEvidence = {
  captureId: string; capturedAt: string; requestedUrl: string; finalUrl: string; title: string; navigationStatus: number | null;
  viewport: { width: number; height: number };
  screenshot: { path: string; mimeType: "image/png"; sha256: string };
  dom: { headings: string[]; text: string; truncated: boolean };
  regions: { name: string; text: string; truncated: boolean; bounds: { x: number; y: number; width: number; height: number } | null }[];
  hostContext: HostContext | null; warnings: string[]; diagnostics: string[]; diagnosticsTruncated: boolean;
};
function origin(value: string) {
  const url = new URL(value);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Capture requires a loopback HTTP origin");
  return url;
}
export async function captureRuntimeContext(raw: CaptureInput): Promise<CaptureEvidence> {
  const options = captureInput.parse(raw), base = origin(options.baseUrl), target = new URL(options.path, base);
  if (target.origin !== base.origin) throw new Error("Capture path must remain on the configured origin");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: options.viewport, deviceScaleFactor: 1, reducedMotion: "reduce", serviceWorkers: "block" });
    // Navigation is caller-directed and restricted even for scripted redirects.
    await context.route("**/*", async (route) => {
      if (route.request().isNavigationRequest() && new URL(route.request().url()).origin !== base.origin) await route.abort();
      else await route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(30_000); page.setDefaultNavigationTimeout(30_000);
    const diagnostics: string[] = []; let diagnosticsTruncated = false;
    page.on("pageerror", () => { if (diagnostics.length < 100) diagnostics.push("Page script error"); else diagnosticsTruncated = true; });
    const response = await page.goto(target.href, { waitUntil: "domcontentloaded" });
    if (!response?.ok()) throw new Error("Capture navigation failed");
    if (options.readySelector) await page.locator(options.readySelector).waitFor({ state: "visible" });
    for (const action of options.steps) {
      const locator = page.locator(action.selector);
      if (action.type === "click") await locator.click();
      else if (action.type === "fill") await locator.fill(action.value);
      else if (action.type === "select") await locator.selectOption(action.value);
      else if (action.type === "check") await locator.setChecked(action.checked);
      else await locator.waitFor({ state: "visible" });
    }
    if (new URL(page.url()).origin !== base.origin) throw new Error("Capture left the configured origin");
    const warnings: string[] = []; let hostContext: HostContext | null = null;
    const metadata = await page.locator("script#docsyde-context[type='application/json']").allTextContents();
    if (metadata.length) { try { hostContext = parseHostContext(JSON.parse(metadata[0])); } catch { warnings.push("Invalid SDK context"); } }
    const text = await page.locator("body").innerText();
    const headings = await page.locator("h1,h2,h3,h4,h5,h6").allInnerTexts();
    const regions: CaptureEvidence["regions"] = [];
    for (const region of options.regions) {
      const locator = page.locator(region.selector); const content = await locator.innerText();
      regions.push({ name: region.name, text: content.slice(0, 10_000), truncated: content.length > 10_000, bounds: await locator.boundingBox() });
    }
    const captureId = randomUUID(), directory = resolve(options.outputDirectory, captureId);
    await mkdir(directory, { recursive: true });
    const screenshotPath = join(directory, "screenshot.png");
    const png = await page.screenshot({ path: screenshotPath, animations: "disabled", type: "png" });
    const evidence: CaptureEvidence = { captureId, capturedAt: new Date().toISOString(), requestedUrl: target.href, finalUrl: page.url(), title: await page.title(), navigationStatus: response.status(), viewport: options.viewport,
      screenshot: { path: screenshotPath, mimeType: "image/png", sha256: createHash("sha256").update(png).digest("hex") },
      dom: { headings: headings.slice(0, 100).map((heading) => heading.slice(0, 1000)), text: text.slice(0, 50_000), truncated: text.length > 50_000 || headings.length > 100 || headings.some((h) => h.length > 1000) },
      regions, hostContext, warnings, diagnostics, diagnosticsTruncated };
    await writeFile(join(directory, "evidence.json"), JSON.stringify(evidence, null, 2), { flag: "wx" });
    return evidence;
  } catch { throw new Error("Browser capture failed; check Chromium installation, URL, selectors, and artifact permissions."); }
  finally { await browser.close(); }
}
