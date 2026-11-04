import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { runRecordV2 } from "./run-record";
import { initialWorkflowStages } from "./run-workflow-state";
import { coverageFailure } from "@/features/sources/impact/source-coverage";
import type { ProductResult } from "@/features/sources/product-analysis";

test("coverage rejection finishes incomplete before planning, without inference or publication", async t => {
  const load = createRequire(import.meta.url), now = new Date().toISOString();
  let record = runRecordV2.parse({ schemaVersion: 2, input: { mode: "current-state", owner: "example", repo: "product", base: "a".repeat(40), head: "a".repeat(40), paths: [] }, title: "Full Scan", status: "running", disposition: null, activeStage: null, reason: null, summary: "Running", startedAt: now, finishedAt: null, execution: { token: randomUUID(), heartbeatAt: now, cancelRequestedAt: null }, stages: initialWorkflowStages() });
  const source: ProductResult = { status: "analyzed", bytes: 0, bundle: { mode: "current-state", repository: "https://github.com/example/product", base: "a".repeat(40), head: "a".repeat(40), limited: true, notice: "Pinned excerpt", inventory: [{ path: "project.ts", kind: "current-file", previousPath: null }], evidence: [{ id: "p1", path: "project.ts", side: "head", commitId: "a".repeat(40), changed: false, status: "available", text: "if (!name.trim()) return;" }] }, analysis: { assessment: "product-change", uncertainties: [], findings: [{ kind: "product-behavior", description: "A name is required.", before: null, after: null, support: "directly-supported", confidence: "high", confidenceReason: "Guard", citations: [{ evidenceId: "p1", startLine: 1, endLine: 1, excerpt: "if (!name.trim()) return;" }], assumptions: [], uncertainties: [], reachabilityEvidenceIds: [] }] } };
  const replacements = [
    ["./run-checkpoints.ts", { writeRunCheckpoint: async (_id: string, _token: string, change: (value: typeof record) => typeof record) => { record = runRecordV2.parse(change(record)); return record; } }],
    ["./run-runtime-config.ts", { loadRunRuntimeConfig: async () => ({ available: false, reason: "no-trusted-workflow" }) }],
    ["../../sources/product-analysis.ts", { captureGenerationContext: async () => ({ repositoryContextUsed: null, runContextUsed: null }), analyzeProductChanges: async () => source, synthesizeProductImpact: async () => coverageFailure("all-eligible-source-findings-lost") }],
    ["../planning/plan-documentation-impact.ts", { planDocumentationImpact: async () => { throw new Error("Planning must not run"); } }],
    ["../review/review-proposal-operations.ts", { retainDocumentationProposal: async () => { throw new Error("Publication must not run"); } }],
  ] as const;
  for (const [path, replacement] of replacements) {
    const resolved = load.resolve(path), previous = load(resolved), cached = load.cache[resolved]!;
    cached.exports = { ...previous, ...replacement }; t.after(() => { cached.exports = previous; });
  }
  const path = load.resolve("./execute-run-workflow.ts"), previous = load.cache[path]; delete load.cache[path];
  t.after(() => { if (previous) load.cache[path] = previous; else delete load.cache[path]; });
  t.mock.method(globalThis, "fetch", () => { throw new Error("No network or AI allowed"); });
  const { executeRunWorkflow }: typeof import("./execute-run-workflow") = load(path);
  await executeRunWorkflow("fixture", record.execution!.token, new AbortController().signal, async () => {});
  assert.equal(record.disposition, "incomplete"); assert.equal(record.reason, "impact-source-coverage-incomplete");
  assert.equal(record.stages.find(stage => stage.key === "impact-synthesis")!.status, "incomplete");
  assert.equal(record.stages.find(stage => stage.key === "documentation-planning")!.status, "skipped");
  assert.equal(record.failure?.diagnostic?.issues?.[0].code, "all-eligible-source-findings-lost");
  assert.equal(record.impact, undefined); assert.equal(record.retainedProposal, undefined);
});
