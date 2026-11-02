import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { captureWorkflowWithRuntime } from "@/runner/runtime/capture-workflow";
import { createRequire } from "node:module";
import { summarizeRuntimeStates } from "@/features/sources/runtime/runtime-state-summary";
import { visualSourceFixture } from "../../../infra/local/runner/visual-fixtures";
import type { RuntimeObserver } from "./runtime-observation";

// Preserve identity relationships, rather than erasing UUID fields independently.
function normalize(value: unknown) {
  const ids = new Map<string, string>();
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item !== "string") return item;
    if (/^\d{4}-\d\d-\d\dT/.test(item)) return "timestamp";
    if (/^[a-f0-9-]{36}$/.test(item)) { if (!ids.has(item)) ids.set(item, `id-${ids.size}`); return ids.get(item); }
    return item;
  }));
}
test("real Chromium: disabled/enabled/throwing/failed and stalled persistence preserve canonical bytes and cleanup order", { timeout: 90000 }, async t => {
  const server = createServer((_req, res) => { res.setHeader("Content-Type", "text/html"); res.end('<h1>Inspection</h1><input id="name"><button id="open" onclick="document.querySelector(\'p\').hidden=false">Open</button><p hidden>Details</p>'); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const load = createRequire(import.meta.url), dbPath = load.resolve("../database/run-inspections.ts"), registryPath = load.resolve("../../features/documentation/runs/run-inspection.ts");
  const original = load(dbPath), cached = load.cache[dbPath]!;
  let persistenceMode = "enabled", attempts = 0, inFlight = 0, maximumInFlight = 0; const attemptTimes: number[] = [];
  cached.exports = { ...original, persistRunInspection: async () => { attempts++; attemptTimes.push(Date.now()); inFlight++; maximumInFlight = Math.max(maximumInFlight, inFlight); try { if (persistenceMode === "persistence-failed") throw Error("SQL unavailable"); if (persistenceMode === "persistence-stalled") await new Promise(() => {}); } finally { inFlight--; } } };
  delete load.cache[registryPath];
  const { startRunInspection, finishRunInspection }: typeof import("@/features/documentation/runs/run-inspection") = load(registryPath);
  t.after(() => { cached.exports = original; });
  const realLaunch = chromium.launch.bind(chromium);
  let counts = { sessions: 0, screenshots: 0 }, closed = false;
  t.mock.method(chromium, "launch", async (...args: Parameters<typeof chromium.launch>) => {
    counts.sessions++; closed = false; const browser = await realLaunch(...args), close = browser.close.bind(browser), context = browser.newContext.bind(browser);
    t.mock.method(browser, "close", async () => { await close(); closed = true; });
    t.mock.method(browser, "newContext", async (...args: Parameters<typeof browser.newContext>) => {
      const c = await context(...args), newPage = c.newPage.bind(c);
      t.mock.method(c, "newPage", async () => {
        const p = await newPage(), screenshot = p.screenshot.bind(p);
        t.mock.method(p, "screenshot", async (...args: Parameters<typeof p.screenshot>) => { counts.screenshots++; return screenshot(...args); }); return p;
      }); return c;
    }); return browser;
  });
  const throwing: RuntimeObserver = { event() { throw Error("observer"); }, preview(_id, bytes) { bytes.fill(0); throw Error("preview"); } };
  let baseline: unknown;
  for (const mode of ["disabled", "enabled", "throwing", "persistence-failed", "persistence-stalled"] as const) {
    persistenceMode = mode;
    counts = { sessions: 0, screenshots: 0 };
    const id = randomUUID(), events: string[] = [], bytes: string[] = [];
    // The persistence boundary is downstream: stalled/failed observation promises never enter capture awaits.
    const observed = startRunInspection(id, randomUUID());
    const observer = mode === "disabled" ? undefined : mode === "throwing" ? throwing : { event: observed.event, preview(captureId: string, png: Uint8Array) { observed.preview(captureId, png); png.fill(0); } };
    const result = await captureWorkflowWithRuntime({ runtime: { mode: "attach", options: { baseUrl } }, workflow: { steps: [{ type: "fill", selector: "#name", value: "private" }, { type: "click", selector: "#open" }, { type: "checkpoint" }] } }, {
      async store(png) { assert.ok(closed, "browser cleanup precedes storage"); events.push("store"); bytes.push(Buffer.from(png).toString("base64")); return { key: randomUUID() }; }, async read() { return null; },
    }, undefined, undefined, observer);
    finishRunInspection(id);
    await new Promise(resolve => setTimeout(resolve, 1100));
    const canonical = { trace: result.trace, summary: summarizeRuntimeStates(visualSourceFixture(), result.trace, "Offline fixture", ["private"]).input, bytes, events, counts };
    if (!baseline) baseline = normalize(canonical); else assert.deepEqual(normalize(canonical), baseline, mode);
  }
  assert.ok(attempts >= 4);
  assert.equal(maximumInFlight, 1);
  assert.ok(attemptTimes.slice(1).every((at, index) => at - attemptTimes[index] >= 990));
});
