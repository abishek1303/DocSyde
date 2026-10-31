import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { InspectionDecision } from "@/features/sources/inspection-decision";
import type { CaptureEvidence } from "@/integrations/browser/capture";
import type { ArtifactStorage } from "@/integrations/storage/artifact-storage";

const load = createRequire(join(process.cwd(), "package.json"));
const capturePath = load.resolve("./infra/local/runner/capture-runtime.ts");
const visionPath = load.resolve("./src/integrations/ai/analyze-screenshot.ts");
const textPath = load.resolve("./src/integrations/ai/generate-structured.ts");
const executorPath = load.resolve("./infra/local/runner/execute-runtime-inspection.ts");
const captureBoundary: typeof import("./capture-runtime") = load(capturePath);
const visionBoundary: typeof import("@/integrations/ai/analyze-screenshot") = load(visionPath);
const textBoundary: typeof import("@/integrations/ai/generate-structured") = load(textPath);
type Executor = typeof import("./execute-runtime-inspection").executeRuntimeInspection;
type Input = Parameters<Executor>[0];
const runtime: Input["runtime"] = { mode: "launch", options: {
  command: process.execPath, args: [], cwd: process.cwd(), baseUrl: "http://127.0.0.1:4317",
} };
const storage: ArtifactStorage = {
  async store() { throw new Error("Executor must delegate storage"); },
  async read() { throw new Error("Executor must delegate storage"); },
};
const visual = { elements: [], observations: ["A visible form is present."], limitations: [] };
function decision(count = 1): InspectionDecision {
  return { status: "inspect", reason: "Source-only reason must not reach vision", staticEvidence: "sufficient", uncertainties: [],
    targets: Array.from({ length: count }, (_, index) => ({
      pathname: `/page-${index}`, description: `Page ${index} form`,
      visibleEvidence: [`Heading ${index}`, `Submit control ${index}`],
      citations: [{ evidenceId: `source-${index}`, startLine: 2, endLine: 2, excerpt: `route: "/page-${index}"` }],
    })),
  };
}
function captured(index = 0): CaptureEvidence {
  return {
    captureId: `capture-${index}`, capturedAt: "2026-10-30T00:00:00.000Z",
    requestedUrl: `http://127.0.0.1:4317/page-${index}`, finalUrl: `http://127.0.0.1:4317/page-${index}`,
    viewport: { width: 1440, height: 900 }, screenshot: { artifactKey: `artifact-${index}`, sha256: `hash-${index}`, mimeType: "image/png" },
    title: "Full captured title", navigationStatus: 200,
    dom: { headings: ["Private DOM heading"], text: "Large DOM payload".repeat(1000), truncated: false },
    regions: [{ name: "region", text: "DOM region", truncated: false, bounds: null }],
    hostContext: { version: 1, applicationId: "fixture", route: "/page", featureIds: [] },
    warnings: ["capture warning"], diagnostics: ["capture diagnostic"], diagnosticsTruncated: false,
  };
}

function setup(
  t: TestContext,
  captureImplementation: typeof captureBoundary.captureWithRuntime = async () => captured(),
  visionImplementation: typeof visionBoundary.analyzeScreenshot = async () => ({ data: visual, model: "meta-vision", elapsedMs: 12 }),
) {
  // As in the existing orchestration tests, scoped cache replacement works with
  // tsx's read-only exports without adding test-only injection to production code.
  const captureModule = load.cache[capturePath], visionModule = load.cache[visionPath], textModule = load.cache[textPath];
  assert.ok(captureModule && visionModule && textModule);
  const originalCapture = captureModule.exports, originalVision = visionModule.exports, originalText = textModule.exports;
  const originalExecutor = load.cache[executorPath];
  const capture = t.mock.fn(captureImplementation), vision = t.mock.fn(visionImplementation);
  const text = t.mock.fn(async () => { throw new Error("Baseten must not run during execution"); });
  const read = t.mock.method(storage, "read", storage.read), store = t.mock.method(storage, "store", storage.store);
  const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network access in executor unit test"); });
  captureModule.exports = { ...captureBoundary, captureWithRuntime: capture };
  visionModule.exports = { ...visionBoundary, analyzeScreenshot: vision };
  textModule.exports = { ...textBoundary, generateStructured: text };
  delete load.cache[executorPath];
  t.after(() => {
    assert.equal(text.mock.callCount(), 0);
    assert.equal(network.mock.callCount(), 0);
    assert.equal(read.mock.callCount(), 0); assert.equal(store.mock.callCount(), 0);
    captureModule.exports = originalCapture; visionModule.exports = originalVision; textModule.exports = originalText;
    if (originalExecutor) load.cache[executorPath] = originalExecutor;
    else delete load.cache[executorPath];
  });
  const { executeRuntimeInspection }: typeof import("./execute-runtime-inspection") = load(executorPath);
  return { executeRuntimeInspection, capture, vision };
}
async function rejectedWith(promise: Promise<unknown>, expected: unknown) {
  const outcome = await promise.then(value => ({ ok: true, value }), value => ({ ok: false, value }));
  assert.equal(outcome.ok, false); assert.strictEqual(outcome.value, expected);
}

test("non-inspect and malformed decisions reject before runtime, storage or vision side effects", async t => {
  const inputs: unknown[] = [
    { ...decision(), status: "not-needed", targets: [] },
    { ...decision(), status: "unresolved", targets: [], uncertainties: ["Route unavailable"] },
    { ...decision(), extra: true }, { ...decision(), targets: [] },
    { ...decision(), targets: [{ ...decision().targets[0], pathname: null }] },
    { ...decision(), targets: [{ ...decision().targets[0], baseUrl: "http://127.0.0.1:9999" }] },
    { ...decision(), targets: [{ ...decision().targets[0], pathname: "https://example.com/page" }] },
    { ...decision(), targets: [{ ...decision().targets[0], pathname: "//example.com/page" }] },
    { ...decision(), targets: [{ ...decision().targets[0], pathname: "/page?id=123" }] },
    { ...decision(), targets: [{ ...decision().targets[0], pathname: "/page/[id]" }] },
    { ...decision(), targets: [{ ...decision().targets[0], pathname: "/../page" }] },
    decision(4), null,
  ];
  const f = setup(t);
  for (const input of inputs) await assert.rejects(f.executeRuntimeInspection({ decision: input as InspectionDecision, runtime }, storage));
  assert.equal(f.capture.mock.callCount(), 0); assert.equal(f.vision.mock.callCount(), 0);
});

test("unknown capture fields and invalid approved settings reject before execution", async t => {
  const f = setup(t);
  for (const capture of [
    { baseUrl: "http://127.0.0.1:9999" }, { path: "/override" }, { pathname: "/override" },
    { steps: [] }, { actions: [] }, { selectors: [] }, { readySelector: "h1" },
    { readinessPath: "/health" }, { regions: [] }, { unknown: true },
    { viewport: { width: 0, height: 900 } }, { viewport: { width: 800, height: 600, baseUrl: "override" } },
    { outputDirectory: 123 }, null,
  ]) {
    await assert.rejects(f.executeRuntimeInspection({ decision: decision(), runtime, capture: capture as Input["capture"] }, storage));
  }
  assert.equal(f.capture.mock.callCount(), 0); assert.equal(f.vision.mock.callCount(), 0);
});

for (const mode of ["launch", "attach"] as const) {
  test(`${mode}: exact path/options/storage and screenshot key are passed to delegated boundaries`, async t => {
    const input = decision(); const target = input.targets[0];
    const selected: Input["runtime"] = mode === "launch" ? runtime : { mode: "attach", options: { baseUrl: "http://127.0.0.1:4317", readinessPath: "/health" } };
    const capture = { viewport: { width: 800, height: 600 }, outputDirectory: "trusted-manifest-directory" };
    const f = setup(t);
    const result = await f.executeRuntimeInspection({ decision: input, runtime: selected, capture }, storage);
    assert.equal(f.capture.mock.callCount(), 1); assert.equal(f.vision.mock.callCount(), 1);
    const [captureInput, captureStorage] = f.capture.mock.calls[0].arguments;
    assert.strictEqual(captureInput.runtime, selected);
    assert.deepEqual(captureInput.capture, { path: target.pathname, viewport: capture.viewport, outputDirectory: capture.outputDirectory });
    assert.equal("baseUrl" in captureInput.capture, false);
    assert.strictEqual(captureStorage, storage);
    const [visionInput, visionStorage] = f.vision.mock.calls[0].arguments;
    assert.deepEqual(visionInput, { artifactKey: "artifact-0", context: [target.description, ...target.visibleEvidence].join("\n") });
    assert.strictEqual(visionStorage, storage);
    assert.ok(!visionInput.context.includes(target.citations[0].evidenceId));
    assert.ok(!visionInput.context.includes(target.citations[0].excerpt));
    assert.ok(!visionInput.context.includes("artifact-0"));
    assert.ok(!visionInput.context.includes("trusted-manifest-directory"));
    assert.ok(!visionInput.context.includes(input.reason));
    assert.deepEqual(result.targets[0].citations, target.citations);
    assert.equal(result.targets[0].pathname, target.pathname);
  });
}

test("capture must completely resolve before vision begins", async t => {
  const order: string[] = [];
  let finishCapture: ((evidence: CaptureEvidence) => void) | undefined;
  const captureResult = new Promise<CaptureEvidence>(resolve => { finishCapture = resolve; });
  const f = setup(t, async () => { order.push("capture-start"); return captureResult; }, async () => {
    order.push("vision"); return { data: visual, model: "meta-vision", elapsedMs: 12 };
  });
  const pending = f.executeRuntimeInspection({ decision: decision(), runtime }, storage);
  assert.equal(f.capture.mock.callCount(), 1); assert.equal(f.vision.mock.callCount(), 0);
  order.push("capture-completed"); assert.ok(finishCapture); finishCapture(captured());
  await pending;
  assert.deepEqual(order, ["capture-start", "capture-completed", "vision"]);
});

test("three targets execute capture then vision sequentially in original decision order", async t => {
  const order: string[] = [];
  let finishFirstVision: ((result: Awaited<ReturnType<typeof visionBoundary.analyzeScreenshot>>) => void) | undefined;
  const firstVision = new Promise<Awaited<ReturnType<typeof visionBoundary.analyzeScreenshot>>>(resolve => { finishFirstVision = resolve; });
  const f = setup(t, async (input, suppliedStorage) => {
    assert.strictEqual(suppliedStorage, storage);
    const index = Number(input.capture.path?.slice(-1)); order.push(`capture-${index}`); return captured(index);
  }, async (input, suppliedStorage) => {
    assert.strictEqual(suppliedStorage, storage);
    const index = Number(input.artifactKey.slice(-1)); order.push(`vision-${index}`);
    if (index === 0) return firstVision;
    return { data: visual, model: "meta-vision", elapsedMs: index };
  });
  const pending = f.executeRuntimeInspection({ decision: decision(3), runtime }, storage);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(order, ["capture-0", "vision-0"]);
  assert.ok(finishFirstVision); finishFirstVision({ data: visual, model: "meta-vision", elapsedMs: 0 });
  const result = await pending;
  assert.deepEqual(order, ["capture-0", "vision-0", "capture-1", "vision-1", "capture-2", "vision-2"]);
  assert.deepEqual(result.targets.map(target => [target.targetIndex, target.pathname, target.capture.captureId]),
    [[0, "/page-0", "capture-0"], [1, "/page-1", "capture-1"], [2, "/page-2", "capture-2"]]);
});

test("capture or vision failure stops later targets, returns no partial success and preserves rejection values", async t => {
  for (const stage of ["capture", "vision"] as const) {
    for (const [index, failure] of [new Error("failure"), undefined, null, false, 0, ""].entries()) {
      await t.test(`${stage} ${index}`, async t => {
        const f = setup(t, async input => {
          const target = Number(input.capture.path?.slice(-1));
          if (stage === "capture" && target === 1) throw failure;
          return captured(target);
        }, async input => {
          if (stage === "vision" && input.artifactKey === "artifact-1") throw failure;
          return { data: visual, model: "meta-vision", elapsedMs: 12 };
        });
        await rejectedWith(f.executeRuntimeInspection({ decision: decision(3), runtime }, storage), failure);
        assert.equal(f.capture.mock.callCount(), 2);
        assert.equal(f.vision.mock.callCount(), stage === "capture" ? 1 : 2);
      });
    }
  }
});

test("compact result contains only existing identities and approved metadata, never DOM/binary/envelopes", async t => {
  const originalCapture = { ...captured(), binary: Buffer.from("secret bytes"), storageRoot: "/private/storage" };
  const originalVision = { data: visual, model: "meta-vision", elapsedMs: 12, providerResponse: { private: true } };
  const f = setup(t, async () => originalCapture, async () => originalVision);
  const input = decision();
  const result = await f.executeRuntimeInspection({ decision: input, runtime }, storage);
  assert.deepEqual(result, { targets: [{
    targetIndex: 0, pathname: "/page-0", description: input.targets[0].description,
    visibleEvidence: input.targets[0].visibleEvidence, citations: input.targets[0].citations,
    capture: { captureId: "capture-0", capturedAt: originalCapture.capturedAt,
      requestedUrl: originalCapture.requestedUrl, finalUrl: originalCapture.finalUrl,
      viewport: originalCapture.viewport, screenshot: originalCapture.screenshot },
    vision: { data: visual, model: "meta-vision", elapsedMs: 12 },
  }] });
  const serialized = JSON.stringify(result);
  for (const excluded of ["Large DOM payload", "private/storage", "providerResponse", "binary", "hostContext", "diagnostics", "regions"]) {
    assert.ok(!serialized.includes(excluded));
  }
});

test("maximum target descriptions/evidence requests remain within vision's context limit", async t => {
  const input = decision(); input.targets[0].description = "D".repeat(300);
  input.targets[0].visibleEvidence = Array(4).fill("E".repeat(300));
  const f = setup(t);
  await f.executeRuntimeInspection({ decision: input, runtime }, storage);
  const context = f.vision.mock.calls[0].arguments[0].context;
  assert.equal(context.length, 1504); assert.ok(context.length <= 4000);
});
