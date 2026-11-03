import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { runRecordV2 } from "./run-record";
import { initialWorkflowStages } from "./run-workflow-state";
import { transformationImpactFixture } from "../../../../infra/local/documentation/transformation-fixtures";
import { ManagedRuntimeUnavailable } from "@/runner/runtime/managed-configuration";
import { RuntimeCleanupError } from "@/runner/runtime/runtime";
import type { ProductResult } from "@/features/sources/product-analysis";

for (const failure of ["startup", "cleanup"] as const) test(`${failure} preserves the source-only / cleanup-failure boundary without inference`, async t => {
  const load = createRequire(import.meta.url), now = new Date().toISOString();
  const impact = transformationImpactFixture(); impact.provenance.source.repository = impact.provenance.source.repository.toLowerCase();
  const source = impact.provenance.source;
  let record = runRecordV2.parse({ schemaVersion: 2, input: { owner: "abishek1303", repo: "docsyde", base: source.base, head: source.head, paths: [] }, title: "Fixture", status: "running", disposition: null, activeStage: null, reason: null, summary: "Running", startedAt: now, finishedAt: null, execution: { token: randomUUID(), heartbeatAt: now, cancelRequestedAt: null }, stages: initialWorkflowStages() });
  const analysis: ProductResult = { status: "analyzed", bytes: 0, bundle: { repository: source.repository, base: source.base, head: source.head, limited: source.limited, notice: source.notice, inventory: [{ path: "form-0.ts", previousPath: null, kind: "modified" }], evidence: [{ id: "patch-1", path: "form-0.ts", side: "patch", commitId: null, changed: true, text: "+required", status: "included" }] }, analysis: { assessment: "product-change", findings: impact.provenance.sourceReferences.map(entry => entry.finding), uncertainties: [] } };
  let synthesized = false;
  const restore: (() => void)[] = [];
  const replacements = [
    ["./run-checkpoints.ts", { writeRunCheckpoint: async (_id: string, _token: string, change: (value: typeof record) => typeof record) => { record = runRecordV2.parse(change(record)); return record; } }],
    ["./run-runtime-config.ts", { loadRunRuntimeConfig: async () => ({ available: true, descriptor: { id: "fixture", version: "1", sha256: "f".repeat(64) }, config: { supportedPathnames: ["/"], supportingSourcePaths: [], capabilities: [] }, storage: {} }) }],
    ["../../sources/product-analysis.ts", { captureGenerationContext: async () => ({ repositoryContextUsed: null, runContextUsed: null }), analyzeProductChanges: async () => analysis,
      readInspectionContext: async () => undefined, decideRuntimeInspection: async () => ({ decision: { status: "inspect", reason: "Inspect selected application", staticEvidence: "sufficient", targets: [{ pathname: "/", description: "Inspect application", visibleEvidence: ["Application UI"], citations: impact.provenance.sourceReferences[0].finding.citations }], uncertainties: [] } }),
      synthesizeProductImpact: async (input: { runtime: unknown[]; runtimeInspection: { outcome: string; limitations: string[] } }) => {
        synthesized = true; assert.deepEqual(input.runtime, []); assert.equal(input.runtimeInspection.outcome, "attempted-and-failed"); assert.match(input.runtimeInspection.limitations.at(-1)!, /source evidence only/);
        return { impact: { ...impact, assessment: "insufficient-evidence", claims: [], provenance: { ...impact.provenance, runtimeInspection: input.runtimeInspection } } };
      } }],
    ["../../../runner/runtime/capture-workflow.ts", { captureWorkflowWithRuntime: async () => { throw failure === "startup" ? new ManagedRuntimeUnavailable("dependencies-missing") : new RuntimeCleanupError(); } }],
  ] as const;
  // Resolve Sources from this module's directory; do not replace its real validators.
  for (const [path, replacement] of replacements) {
    const resolved = load.resolve(path), prior = load(resolved), cached = load.cache[resolved]!;
    cached.exports = { ...prior, ...replacement }; restore.push(() => { cached.exports = prior; });
  }
  const workflowPath = load.resolve("./execute-run-workflow.ts"), priorWorkflow = load.cache[workflowPath]; delete load.cache[workflowPath];
  t.after(() => { restore.forEach(fn => fn()); if (priorWorkflow) load.cache[workflowPath] = priorWorkflow; else delete load.cache[workflowPath]; });
  t.mock.method(globalThis, "fetch", () => { throw new Error("No network or inference allowed"); });
  const { executeRunWorkflow }: typeof import("./execute-run-workflow") = load(workflowPath);
  if (failure === "cleanup") { await assert.rejects(executeRunWorkflow("fixture", record.execution!.token, new AbortController().signal, async () => {}), /runtime-inspection/); assert.equal(synthesized, false); }
  else {
    await executeRunWorkflow("fixture", record.execution!.token, new AbortController().signal, async () => {});
    assert.equal(synthesized, true); assert.equal(record.disposition, "incomplete");
    assert.equal(record.runtime?.reason, "managed-dependencies-missing");
    assert.equal(record.stages.find(stage => stage.key === "runtime-inspection")!.status, "skipped");
    assert.equal(record.artifacts.length, 0);
  }
});
