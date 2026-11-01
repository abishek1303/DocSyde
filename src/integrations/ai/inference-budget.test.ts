import { test } from "node:test";
import assert from "node:assert/strict";
import { admitInference, requireInferenceLog, assertPlannedGenerationBatches, stopInferenceBudget, withInferenceBudget, InferenceBudgetError } from "./inference-budget";
import { inferenceSnapshot, resolveInference } from "./operation-policy";

const settings = resolveInference("baseten", "source-analysis");
const expected = { "source-analysis": { provider: "baseten" as const, model: settings.model, config: inferenceSnapshot("source-analysis", settings) } };
test("budget admits unchanged settings once and denies duplicate dispatch", async () => {
  await withInferenceBudget("run", expected, async () => {
    await admitInference("baseten", "source-analysis", settings, "run");
    await assert.rejects(admitInference("baseten", "source-analysis", settings, "run"), { code: "inference-budget-exceeded" });
  });
});
test("configuration drift and stopped execution fail before dispatch", async () => {
  await withInferenceBudget("run", expected, async () => {
    await assert.rejects(admitInference("baseten", "source-analysis", { ...settings, maxOutputTokens: 1 }, "run"), { code: "inference-config-drift" });
  });
  await withInferenceBudget("run", expected, async () => {
    stopInferenceBudget();
    await assert.rejects(admitInference("baseten", "source-analysis", settings, "run"), { code: "inference-budget-stopped" });
  });
});
test("multi-batch plans are scope exclusions before any generation", async () => {
  await withInferenceBudget("run", expected, async () => {
    assertPlannedGenerationBatches(1);
    assert.throws(() => assertPlannedGenerationBatches(2), (error: unknown) => error instanceof InferenceBudgetError && error.code === "outside-single-batch-scope");
    await assert.rejects(admitInference("baseten", "source-analysis", settings, "run"), { code: "inference-budget-stopped" });
  });
  assert.doesNotThrow(() => assertPlannedGenerationBatches(8));
});
test("failed baseline recheck and unrelated runs cannot spend inference", async () => {
  let checked = 0;
  await withInferenceBudget("run", expected, async () => {
    await assert.rejects(admitInference("baseten", "source-analysis", settings, "other"), { code: "unguarded-baseline-call" });
  });
  await withInferenceBudget("run", expected, async () => {
    await assert.rejects(admitInference("baseten", "source-analysis", settings, "run"), /corpus drift/);
    assert.equal(checked, 1);
  }, async () => { checked++; throw new Error("corpus drift"); });
});

test("operational budget stops the ninth distinct attempt and leaves ordinary calls unguarded", async () => {
  const operations = Object.fromEntries(Array.from({ length: 9 }, (_, index) => {
    const operation = `test-operation-${index}`;
    return [operation, { provider: "baseten" as const, model: settings.model, config: inferenceSnapshot(operation, settings) }];
  }));
  await withInferenceBudget("run", operations, async () => {
    for (let index = 0; index < 8; index++) await admitInference("baseten", `test-operation-${index}`, settings, "run");
    await assert.rejects(admitInference("baseten", "test-operation-8", settings, "run"), { code: "inference-budget-exceeded" });
  });
  await assert.doesNotReject(admitInference("baseten", "source-analysis", settings));
});

test("experiment mode rejects an unguarded generation at the real dispatch boundary", async t => {
  const previous = process.env.DOCSYDE_RELIABILITY_MANIFEST;
  process.env.DOCSYDE_RELIABILITY_MANIFEST = "operator-manifest.json";
  t.after(() => { if (previous === undefined) delete process.env.DOCSYDE_RELIABILITY_MANIFEST; else process.env.DOCSYDE_RELIABILITY_MANIFEST = previous; });
  const network = t.mock.method(globalThis, "fetch", () => { throw new Error("No network expected"); });
  const { generateStructured } = await import("./generate-structured");
  const { z } = await import("zod");
  await assert.rejects(generateStructured({ instructions: "Offline boundary check", input: "Offline input", schema: z.literal("ok") }), { code: "unguarded-baseline-call" });
  assert.equal(network.mock.callCount(), 0);
});


test("experiment logging must succeed before paid dispatch while ordinary logging remains best-effort", async () => {
  assert.doesNotThrow(() => requireInferenceLog(false));
  await withInferenceBudget("run", expected, async () => {
    assert.throws(() => requireInferenceLog(false), { code: "inference-log-unavailable" });
    await assert.rejects(admitInference("baseten", "source-analysis", settings, "run"), { code: "inference-budget-stopped" });
  });
});
