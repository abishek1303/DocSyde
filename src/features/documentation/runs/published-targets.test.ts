import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { runRecordV2 } from "./run-record";
import { initialWorkflowStages } from "./run-workflow-state";
import { transformationImpactFixture } from "../../../../infra/local/documentation/transformation-fixtures";
import fixture from "@/features/sources/analysis/fixtures/blocked-status.json";

for (const currentState of [false, true]) test(`workflow passes published-only scope while preserving ${currentState ? "Full Scan isolation" : "Latest Changes targeting"}`, async t => {
  const load = createRequire(import.meta.url), now = new Date().toISOString();
  const source = structuredClone(fixture);
  const impact = transformationImpactFixture();
  let record = runRecordV2.parse({ schemaVersion: 2, input: { ...(currentState ? { mode: "current-state" } : {}), owner: "example", repo: "product", base: "a".repeat(40), head: currentState ? "a".repeat(40) : "b".repeat(40), paths: [] }, title: "Scope test", status: "running", disposition: null, activeStage: null, reason: null, summary: "Running", startedAt: now, finishedAt: null, execution: { token: randomUUID(), heartbeatAt: now, cancelRequestedAt: null }, stages: initialWorkflowStages() });
  const stop = new Error("Planner reached; no inference or publication");
  let planningCalls = 0;
  const replacements = [
    ["./run-checkpoints.ts", { writeRunCheckpoint: async (_id: string, _token: string, change: (value: typeof record) => typeof record) => { record = change(record); return record; } }],
    ["./run-runtime-config.ts", { loadRunRuntimeConfig: async () => ({ available: false, reason: "no-trusted-workflow" }) }],
    ["../../sources/product-analysis.ts", { captureGenerationContext: async () => ({ repositoryContextUsed: null, runContextUsed: null }), analyzeProductChanges: async () => ({ ...source, status: "analyzed", bytes: 0, analysis: source.output }), validateProductResult: (value: unknown) => value, synthesizeProductImpact: async () => ({ impact, model: "mock", elapsedMs: 1 }), discoverProductRoutes: () => [] }],
    ["../planning/plan-documentation-impact.ts", { planDocumentationImpact: async (input: { publishedOnly?: boolean; objective?: string; impact: unknown; context: unknown }) => {
      planningCalls++; assert.equal(input.publishedOnly, true); assert.equal(input.objective, currentState ? "fresh" : undefined);
      assert.deepEqual(input.impact, impact); assert.deepEqual(input.context, record.input.associations); throw stop;
    } }],
  ] as const;
  for (const [path, replacement] of replacements) {
    const resolved = load.resolve(path), previous = load(resolved), cached = load.cache[resolved]!;
    cached.exports = { ...previous, ...replacement }; t.after(() => { cached.exports = previous; });
  }
  const path = load.resolve("./execute-run-workflow.ts"), previous = load.cache[path]; delete load.cache[path];
  t.after(() => { if (previous) load.cache[path] = previous; else delete load.cache[path]; });
  t.mock.method(globalThis, "fetch", () => { throw new Error("No network permitted"); });
  const { executeRunWorkflow, RunStageError }: typeof import("./execute-run-workflow") = load(path);
  await assert.rejects(executeRunWorkflow("fixture", record.execution!.token, new AbortController().signal, async () => {}), error => { if (error instanceof RunStageError && error.cause !== stop) throw error.cause; return error instanceof RunStageError && error.cause === stop; });
  assert.equal(planningCalls, 1);
});
