import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RuntimeSession } from "@/runner/runtime/runtime";
import type { CaptureEvidence } from "@/integrations/browser/capture";
import type { ArtifactStorage } from "@/integrations/storage/artifact-storage";
import { createLocalStorage } from "@/integrations/storage/local-storage";

const load = createRequire(join(process.cwd(), "package.json"));
const runtimePath = load.resolve("./src/runner/runtime/runtime.ts");
const capturePath = load.resolve("./src/integrations/browser/capture.ts");
const helperPath = load.resolve("./infra/local/runner/capture-runtime.ts");
const runtimeBoundary: typeof import("@/runner/runtime/runtime") = load(runtimePath);
const captureBoundary: typeof import("@/integrations/browser/capture") = load(capturePath);

// tsx exposes read-only module exports. Replace only the two dependency cache
// entries while loading the helper, then restore them after each scoped test.
// This avoids test-only injection parameters in the orchestration contract.
function mockedHelper(
  t: TestContext,
  runtime: Partial<typeof runtimeBoundary>,
  capture: typeof captureBoundary.captureRuntimeContext,
): typeof import("./capture-runtime") {
  const runtimeModule = load.cache[runtimePath], captureModule = load.cache[capturePath];
  assert.ok(runtimeModule && captureModule);
  const previousRuntime = runtimeModule.exports, previousCapture = captureModule.exports;
  const previousHelper = load.cache[helperPath];
  runtimeModule.exports = { ...runtimeBoundary, ...runtime };
  captureModule.exports = { ...captureBoundary, captureRuntimeContext: capture };
  delete load.cache[helperPath];
  t.after(() => {
    runtimeModule.exports = previousRuntime;
    captureModule.exports = previousCapture;
    if (previousHelper) load.cache[helperPath] = previousHelper;
    else delete load.cache[helperPath];
  });
  return load(helperPath);
}

const baseUrl = "http://127.0.0.1:4317";
const launch = { mode: "launch" as const, options: {
  cwd: process.cwd(), command: process.execPath, args: [], baseUrl,
} };
const attach = { mode: "attach" as const, options: { baseUrl } };
const evidence: CaptureEvidence = {
  captureId: "capture", capturedAt: "2026-10-30T00:00:00.000Z",
  requestedUrl: baseUrl, finalUrl: baseUrl, title: "Proof", navigationStatus: 200,
  viewport: { width: 1440, height: 900 },
  screenshot: { artifactKey: "artifact", mimeType: "image/png", sha256: "hash" },
  dom: { headings: [], text: "ready", truncated: false }, regions: [],
  hostContext: null, warnings: [], diagnostics: [], diagnosticsTruncated: false,
};
const storage: ArtifactStorage = {
  async store() { throw new Error("Orchestration must not call storage directly"); },
  async read() { throw new Error("Orchestration must not read storage"); },
};
function session(stop: RuntimeSession["stop"]): RuntimeSession {
  return { description: { runtimeId: "runtime", mode: "launched", baseUrl: `${baseUrl}/resolved`, startedAt: "now" }, stop };
}
async function rejectedWith(promise: Promise<unknown>, expected: unknown) {
  // assert.rejects does not cover every primitive rejection value consistently.
  const outcome = await promise.then(value => ({ ok: true, value }), value => ({ ok: false, value }));
  assert.equal(outcome.ok, false);
  assert.strictEqual(outcome.value, expected);
}

for (const runtime of [launch, attach]) {
  test(`${runtime.mode}: awaits creation/readiness, forwards options/storage and stops once before returning original evidence`, async t => {
    const order: string[] = [];
    let ready: ((session: RuntimeSession) => void) | undefined;
    const creation = new Promise<RuntimeSession>(resolve => { ready = resolve; });
    let stopped: (() => void) | undefined;
    const stopping = new Promise<void>(resolve => { stopped = resolve; });
    const stop = t.mock.fn(async () => { order.push("stop"); await stopping; });
    const created = session(stop);
    const create = t.mock.fn(async (options: unknown) => {
      assert.strictEqual(options, runtime.options); order.push("create"); return creation;
    });
    const capture = { path: "/proof", outputDirectory: "output", readySelector: "h1",
      viewport: { width: 800, height: 600 }, baseUrl: "http://127.0.0.1:9999/conflict" };
    const captureCall = t.mock.fn(async (input: Parameters<typeof captureBoundary.captureRuntimeContext>[0], suppliedStorage: ArtifactStorage) => {
      order.push("capture");
      assert.deepEqual(input, { ...capture, baseUrl: created.description.baseUrl });
      assert.strictEqual(suppliedStorage, storage);
      return evidence;
    });
    const { captureWithRuntime } = mockedHelper(t, {
      launchRuntime: runtime.mode === "launch" ? create : async () => { throw new Error("Wrong mode"); },
      attachRuntime: runtime.mode === "attach" ? create : async () => { throw new Error("Wrong mode"); },
    }, captureCall);
    const pending = captureWithRuntime({ runtime, capture }, storage);
    assert.equal(captureCall.mock.callCount(), 0); assert.equal(stop.mock.callCount(), 0);
    assert.ok(ready); ready(created);
    // Wait for the capture and stop continuations without releasing stop.
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(order, ["create", "capture", "stop"]);
    let returned = false;
    const result = pending.then(value => { returned = true; return value; });
    await Promise.resolve(); assert.equal(returned, false);
    assert.ok(stopped); stopped();
    assert.strictEqual(await result, evidence);
    assert.equal(create.mock.callCount(), 1);
    assert.equal(captureCall.mock.callCount(), 1);
    assert.equal(stop.mock.callCount(), 1);
  });
}

const failures = [new Error("failure"), undefined, null, false, 0, ""];
test("creation/readiness failures propagate unchanged with no capture or orchestration cleanup", async t => {
  for (const runtime of [launch, attach]) {
    for (const [index, failure] of failures.entries()) {
      await t.test(`${runtime.mode} rejection ${index}`, async t => {
        const stop = t.mock.fn(async () => {});
        const capture = t.mock.fn(async () => evidence);
        const create = async () => { throw failure; };
        const { captureWithRuntime } = mockedHelper(t, { launchRuntime: create, attachRuntime: create }, capture);
        await rejectedWith(captureWithRuntime({ runtime, capture: {} }, storage), failure);
        assert.equal(capture.mock.callCount(), 0);
        assert.equal(stop.mock.callCount(), 0);
      });
    }
  }
});

test("capture-only, stop-only and simultaneous failures preserve every rejection value", async t => {
  for (const [index, failure] of failures.entries()) {
    for (const stage of ["capture", "stop", "both"] as const) {
      await t.test(`${stage} rejection ${index}`, async t => {
        const stopFailure = stage === "both" ? failures[(index + 1) % failures.length] : failure;
        const stop = t.mock.fn(async () => { if (stage !== "capture") throw stopFailure; });
        const capture = t.mock.fn(async () => { if (stage !== "stop") throw failure; return evidence; });
        const { captureWithRuntime } = mockedHelper(t, { launchRuntime: async () => session(stop) }, capture);
        const result = captureWithRuntime({ runtime: launch, capture: {} }, storage);
        if (stage === "both") {
          await assert.rejects(result, error => {
            assert.ok(error instanceof AggregateError);
            assert.equal(error.errors.length, 2);
            assert.strictEqual(error.errors[0], failure);
            assert.strictEqual(error.errors[1], stopFailure);
            return true;
          });
        } else await rejectedWith(result, failure);
        assert.equal(capture.mock.callCount(), 1);
        assert.equal(stop.mock.callCount(), 1);
      });
    }
  }
});

async function isolatedStorage(t: TestContext) {
  const root = await fs.mkdtemp(join(tmpdir(), "docsyde-runtime-capture-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { outputDirectory: join(root, "manifests"), storage: createLocalStorage(join(root, "artifacts")) };
}

async function unusedPort() {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address(); assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return address.port;
}

test("real launch: ready fixture → Playwright → local storage → evidence → owned-child cleanup", async t => {
  const { captureWithRuntime }: typeof import("./capture-runtime") = load(helperPath);
  const port = await unusedPort();
  const url = `http://127.0.0.1:${port}`;
  const f = await isolatedStorage(t);
  const result = await captureWithRuntime({ runtime: { mode: "launch", options: {
    cwd: process.cwd(), command: process.execPath,
    args: ["infra/local/runner/fixture.mjs", String(port)], baseUrl: url, startupTimeoutMs: 5000,
  } }, capture: { outputDirectory: f.outputDirectory } }, f.storage);
  assert.equal(result.requestedUrl, `${url}/`);
  assert.equal(result.navigationStatus, 200);
  assert.equal(result.dom.text, "ready");
  const png = await f.storage.read(result.screenshot.artifactKey); assert.ok(png);
  assert.equal(Buffer.from(png).subarray(1, 4).toString(), "PNG");
  const manifest = JSON.parse(await fs.readFile(join(f.outputDirectory, result.captureId, "evidence.json"), "utf8"));
  assert.deepEqual(manifest, result);
  await assert.rejects(fetch(url));
});

test("real attach waits for readiness, captures, and leaves the externally owned application serving", async t => {
  const { captureWithRuntime }: typeof import("./capture-runtime") = load(helperPath);
  const f = await isolatedStorage(t);
  let ready = false;
  let observedWaiting: (() => void) | undefined;
  const waiting = new Promise<void>(resolve => { observedWaiting = resolve; });
  const events: string[] = [];
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      events.push(ready ? "ready" : "waiting");
      res.statusCode = ready ? 200 : 503;
      res.end("health");
      if (!ready) observedWaiting?.();
    } else { events.push("capture"); res.end("<h1>Attached proof</h1>"); }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const pending = captureWithRuntime({ runtime: { mode: "attach", options: {
    baseUrl: url, readinessPath: "/health", startupTimeoutMs: 5000,
  } }, capture: { outputDirectory: f.outputDirectory } }, f.storage);
  // The first health request returns 503; release readiness only afterward.
  await Promise.race([waiting, pending]);
  assert.ok(events.includes("waiting"));
  assert.equal(events.includes("capture"), false);
  ready = true;
  const result = await pending;
  assert.ok(events.indexOf("ready") < events.indexOf("capture"));
  assert.deepEqual(result.dom.headings, ["Attached proof"]);
  assert.ok(await f.storage.read(result.screenshot.artifactKey));
  assert.ok((await fetch(url)).ok);
});
