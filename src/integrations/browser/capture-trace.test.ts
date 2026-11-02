import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import { chromium, type Page, type PageScreenshotOptions } from "playwright";
import { captureRuntimeTrace } from "./capture-trace";
import type { ArtifactStorage } from "@/integrations/storage/artifact-storage";

// Read one actual screenshot pixel (PNG RGB/RGBA, all standard row filters).
function pixel(png: Buffer, x: number, y: number) {
  let offset = 8, width = 0, channels = 0;
  const chunks: Buffer[] = [];
  while (offset < png.length) {
    const size = png.readUInt32BE(offset), type = png.toString("ascii", offset + 4, offset + 8), data = png.subarray(offset + 8, offset + 8 + size);
    if (type === "IHDR") { width = data.readUInt32BE(0); channels = data[9] === 6 ? 4 : 3; assert.equal(data[8], 8); }
    if (type === "IDAT") chunks.push(data);
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels;
  let previous = Buffer.alloc(stride);
  for (let row = 0; row <= y; row++) {
    const filter = raw[row * (stride + 1)], current = Buffer.from(raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? current[i - channels] : 0, b = previous[i], c = i >= channels ? previous[i - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? pa <= pb && pa <= pc ? a : pb <= pc ? b : c : 0;
      current[i] = (current[i] + predictor) & 255;
    }
    previous = current;
  }
  return [...previous.subarray(x * channels, x * channels + 3)];
}

async function fixture(t: TestContext) {
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(`<h1>Request form</h1><label>Name <input id="name"></label><textarea>private initial value</textarea>
      <select id="choice"><option value="first">First private choice</option><option value="second">Second private choice</option></select>
      <div id="sensitive">account-secret</div><p>{"access_token":"json-secret"}</p><p id="echo"></p><p>Visible guidance</p>
      <button id="open" onclick="document.querySelector('dialog').showModal()">Open details</button>
      <dialog aria-label="Details"><p>Required field guidance</p><button id="close" onclick="document.querySelector('dialog').close()">Close</button></dialog>
      <button id="route" onclick="location.href='/next?token=private'">Next</button>
      <script>document.querySelector('#name').oninput=e=>document.querySelector('#echo').textContent=e.target.value</script>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const bytes = new Map<string, Uint8Array>();
  const state = { launches: 0, contexts: 0, screenshots: 0, closed: false, masks: 0, inputPoint: { x: 0, y: 0 } };
  let prepare: (page: Page) => void = () => {};
  const launch = chromium.launch.bind(chromium);
  t.mock.method(chromium, "launch", async (...args: Parameters<typeof chromium.launch>) => {
    state.launches++;
    const browser = await launch(...args), close = browser.close.bind(browser), newContext = browser.newContext.bind(browser);
    t.after(() => close());
    t.mock.method(browser, "close", async () => { await close(); state.closed = true; });
    t.mock.method(browser, "newContext", async (...args: Parameters<typeof browser.newContext>) => {
      state.contexts++;
      const context = await newContext(...args), newPage = context.newPage.bind(context);
      t.mock.method(context, "newPage", async () => {
        const page = await newPage(), screenshot = page.screenshot.bind(page);
        t.mock.method(page, "screenshot", async (options?: PageScreenshotOptions) => {
          state.screenshots++; state.masks = await options!.mask![0].count();
          const bounds = await page.locator("#name").boundingBox(); assert.ok(bounds);
          state.inputPoint = { x: Math.floor(bounds.x + bounds.width / 2), y: Math.floor(bounds.y + bounds.height / 2) };
          return screenshot(options);
        });
        prepare(page); return page;
      }); return context;
    }); return browser;
  });
  const storage: ArtifactStorage = { async store(png) { assert.equal(state.closed, true); const key = randomUUID(); bytes.set(key, png); return { key }; }, async read(key) { return bytes.get(key) ?? null; } };
  return { baseUrl: `http://127.0.0.1:${address.port}`, storage, bytes, state, prepare(fn: typeof prepare) { prepare = fn; } };
}

test("one browser workflow preserves transient states, masks actual pixels and never infers or screenshots fills", async t => {
  const f = await fixture(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("No models during capture"); });
  const trace = await captureRuntimeTrace({ baseUrl: f.baseUrl, sensitiveSelectors: ["#sensitive"],
    steps: [{ type: "fill", selector: "#name", value: "entered-secret" }, { type: "fill", selector: "#name", value: "second-secret" },
      { type: "click", selector: "#open" }, { type: "checkpoint" }, { type: "click", selector: "#close" }, { type: "click", selector: "#route" }] }, f.storage);
  assert.equal(f.state.launches, 1); assert.equal(f.state.contexts, 1); assert.equal(fetch.mock.callCount(), 0);
  assert.equal(trace.coverage.stateBoundaries, 8);
  assert.deepEqual(trace.events.map(event => event.trigger), ["initial", "fill", "fill", "click", "checkpoint", "click", "click", "final"]);
  assert.ok(trace.states.some(state => state.snapshot.overlays.some(text => text.includes("Required field guidance"))));
  assert.ok(trace.checkpoints.some(cp => trace.states.find(state => state.stateId === cp.stateId)?.snapshot.overlays.length));
  assert.ok(trace.states.some(state => state.snapshot.controls.some(control => control.populated === true)));
  const json = JSON.stringify(trace);
  for (const secret of ["entered-secret", "second-secret", "account-secret", "json-secret", "private initial value", "First private choice", "?token", '"selector"', '"value"']) assert.ok(!json.includes(secret), secret);
  assert.ok(json.includes("Visible guidance"));
  assert.ok(f.state.screenshots < trace.coverage.stateBoundaries - 1);
  assert.ok(f.state.masks >= 4);
  const first = trace.checkpoints[0].screenshot!;
  const png = Buffer.from((await f.storage.read(first.artifactKey))!);
  assert.deepEqual(pixel(png, f.state.inputPoint.x, f.state.inputPoint.y), [0, 0, 0]);
});

test("missing required mask fails closed and exposes checkpoint ineligibility", async t => {
  const f = await fixture(t);
  const trace = await captureRuntimeTrace({ baseUrl: f.baseUrl, sensitiveSelectors: ["#missing"] }, f.storage);
  assert.equal(f.state.screenshots, 0); assert.equal(f.bytes.size, 0);
  assert.equal(trace.checkpoints[0].eligible, false); assert.equal(trace.checkpoints[0].limitation, "masking-failed");
  assert.equal(trace.states[0].snapshot.text, "");
});

test("explicit repeated checkpoints reuse stored bytes; configured crops preserve local geometry", async t => {
  const f = await fixture(t);
  const trace = await captureRuntimeTrace({ baseUrl: f.baseUrl, screenshotRegion: "h1", steps: [{ type: "checkpoint" }, { type: "checkpoint" }] }, f.storage);
  assert.equal(trace.states.length, 1); assert.equal(trace.states[0].occurrences, 4);
  assert.equal(trace.checkpoints.length, 3); assert.equal(f.bytes.size, 1);
  assert.ok(trace.checkpoints.every(cp => cp.crop !== null));
  const png = Buffer.from((await f.storage.read(trace.checkpoints[0].screenshot!.artifactKey))!);
  assert.ok(png.readUInt32BE(20) < trace.viewport.height);
});

test("screenshot and crop failures retain explicit ineligible checkpoints", async t => {
  for (const kind of ["screenshot", "crop"] as const) await t.test(kind, async t => {
    const f = await fixture(t);
    if (kind === "screenshot") f.prepare(page => { t.mock.method(page, "screenshot", async () => { throw new Error("private screenshot details"); }); });
    const trace = await captureRuntimeTrace({ baseUrl: f.baseUrl, screenshotRegion: kind === "crop" ? "dialog" : undefined }, f.storage);
    assert.equal(trace.checkpoints[0].limitation, "screenshot-failed"); assert.equal(f.bytes.size, 0);
    assert.ok(!JSON.stringify(trace).includes("private screenshot details"));
  });
});

test("local state, checkpoint, text and image limits report coverage explicitly", async t => {
  for (const kind of ["states", "checkpoints", "bytes"] as const) await t.test(kind, async t => {
    const f = await fixture(t);
    f.prepare(page => page.on("domcontentloaded", () => { void page.locator("body").evaluate(el => { const p = document.createElement("p"); p.textContent = "large ".repeat(2000); el.append(p); }); }));
    const trace = await captureRuntimeTrace({ baseUrl: f.baseUrl, steps: [{ type: "click", selector: "#open" }, { type: "click", selector: "#close" }],
      limits: kind === "states" ? { maxStates: 1 } : kind === "checkpoints" ? { maxCheckpoints: 1 } : { maxScreenshotBytes: 1 } }, f.storage);
    assert.ok(trace.coverage.truncatedSnapshots > 0);
    if (kind === "states") assert.ok(trace.coverage.omittedStates > 0);
    if (kind === "checkpoints") assert.ok(trace.coverage.omittedCheckpoints > 0);
    if (kind === "bytes") assert.ok(trace.checkpoints.every(cp => cp.limitation === "image-budget"));
  });
});

test("action, storage and cancellation failures never produce a completed trace", async t => {
  for (const kind of ["action", "storage", "cancelled"] as const) await t.test(kind, async t => {
    const f = await fixture(t), controller = new AbortController();
    if (kind === "storage") t.mock.method(f.storage, "store", async () => { throw new Error("Storage unavailable"); });
    if (kind === "cancelled") f.prepare(page => page.on("domcontentloaded", () => controller.abort()));
    await assert.rejects(captureRuntimeTrace({ baseUrl: f.baseUrl, steps: kind === "action" ? [{ type: "click", selector: "[invalid" }] : [] }, f.storage, controller.signal));
    assert.equal(f.state.closed, true);
  });
});

test("real canonical browser emits ordered launch/navigation/action/checkpoint/storage events without sensitive content", async t => {
  const f = await fixture(t), events: import("./runtime-observation").RuntimeObservationInput[] = [];
  const trace = await captureRuntimeTrace({ baseUrl: f.baseUrl, path: "/safe?token=private", secrets: ["private-value"], steps: [
    { type: "fill", selector: "#name", value: "private-value" }, { type: "click", selector: "#open" }, { type: "waitFor", selector: "dialog[open]" },
  ] }, f.storage, undefined, undefined, { event(event) { events.push(event); }, preview() {} });
  assert.equal(f.state.launches, 1); assert.equal(f.state.contexts, 1);
  const kinds = events.map(e => e.kind);
  assert.ok(kinds.indexOf("browser-launch-started") < kinds.indexOf("browser-launched"));
  assert.ok(kinds.indexOf("browser-launched") < kinds.indexOf("navigation-started"));
  assert.ok(kinds.indexOf("navigation-started") < kinds.indexOf("navigation-completed"));
  assert.ok(kinds.indexOf("navigation-completed") < kinds.indexOf("state-captured"));
  assert.ok(kinds.indexOf("browser-stopped") < kinds.indexOf("screenshot-stored"));
  assert.equal(events.filter(e => e.kind === "action-started").length, 3);
  assert.equal(events.filter(e => e.kind === "action-completed").length, 3);
  const stored = events.filter(e => e.kind === "screenshot-stored");
  assert.equal(stored.length, trace.checkpoints.filter(cp => cp.screenshot).length);
  for (const event of stored) {
    assert.ok(event.kind === "screenshot-stored");
    const cp = trace.checkpoints.find(cp => cp.captureId === event.captureId)!;
    assert.ok(cp.eligible); assert.ok(f.bytes.has(cp.screenshot!.artifactKey));
  }
  for (const secret of ["#name", "#open", "private-value", "token=", "account-secret", "private initial value"]) assert.ok(!JSON.stringify(events).includes(secret));
});

for (const failure of ["browser", "navigation", "readiness", "action", "storage", "cleanup"] as const) test(`safe ${failure} failure event preserves canonical errors and cleanup`, async t => {
  const f = await fixture(t), events: import("./runtime-observation").RuntimeObservationInput[] = [], original = new Error("UNSAFE token=private exception /Users/private/path");
  if (failure === "browser") t.mock.method(chromium, "launch", async () => { throw original; });
  else f.prepare(page => {
    if (failure === "navigation") t.mock.method(page, "goto", async () => { throw original; });
    if (failure === "cleanup") { const browser = page.context().browser()!, close = browser.close.bind(browser); t.mock.method(browser, "close", async () => { await close(); throw original; }); }
    if (failure === "readiness" || failure === "action") {
      const locator = page.locator("#missing"), real = page.locator.bind(page);
      t.mock.method(page, "locator", (...args: Parameters<typeof page.locator>) => args[0] === "#missing" ? locator : real(...args));
      t.mock.method(locator, failure === "readiness" ? "waitFor" : "click", async () => { throw new (await import("playwright")).errors.TimeoutError("UNSAFE selector #missing"); });
    }
  });
  if (failure === "storage") t.mock.method(f.storage, "store", async () => { throw original; });
  await assert.rejects(captureRuntimeTrace({ baseUrl: f.baseUrl, ...(failure === "readiness" ? { readySelector: "#missing" } : {}), steps: failure === "action" ? [{ type: "click", selector: "#missing" }] : [] }, f.storage, undefined, undefined, { event: event => { events.push(event); }, preview() {} }), error => {
    if (["browser", "storage", "cleanup"].includes(failure)) assert.equal(error, original);
    else assert.ok(error instanceof Error && error.message === "Runtime workflow failed; check readiness, selectors and local application.");
    return true;
  });
  const code = { browser: "browser-launch-failed", navigation: "navigation-failed", readiness: "page-readiness-failed", action: "action-timeout", storage: "artifact-storage-failed", cleanup: "browser-cleanup-failed" }[failure];
  assert.ok(events.some(e => e.kind === "failure" && e.code === code));
  assert.ok(!events.some(e => e.kind === "canonical-evidence-retained"));
  assert.ok(!JSON.stringify(events).includes("UNSAFE")); assert.ok(!JSON.stringify(events).includes("#missing"));
  assert.equal(f.bytes.size, 0);
  if (failure !== "browser") assert.ok(f.state.closed);
});
