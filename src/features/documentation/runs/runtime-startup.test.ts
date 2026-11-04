import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { runRecordV2 } from "./run-record";
import { initialWorkflowStages } from "./run-workflow-state";
import { transformationImpactFixture, transformationDecisionFixture, transformationEntryFixture } from "../../../../infra/local/documentation/transformation-fixtures";
import { ManagedRuntimeUnavailable } from "@/runner/runtime/managed-configuration";
import { RuntimeCleanupError } from "@/runner/runtime/runtime";
import type { TransformationAuthorization } from "../transformation/transformation-input";
import type { DocumentationChangeProposal } from "../transformation/documentation-change-proposal";
import type { ProductResult } from "@/features/sources/product-analysis";

for (const failure of ["package-manager-missing", "project-dependencies-missing", "startup-failed", "readiness-timeout", "cleanup"] as const) test(`${failure} preserves the source-only / cleanup-failure boundary without inference`, async t => {
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
    ["../../../runner/runtime/capture-workflow.ts", { captureWorkflowWithRuntime: async () => { throw failure !== "cleanup" ? new ManagedRuntimeUnavailable(failure, failure === "package-manager-missing" ? "pnpm" : undefined) : new RuntimeCleanupError(); } }],
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
    assert.equal(record.runtime?.reason, `managed-${failure}`);
    assert.equal(runRecordV2.safeParse({ ...record, runtimeStartup: { missingExecutable: "/private/token", command: "secret" } }).success, false);
    assert.deepEqual(record.runtimeStartup, failure === "package-manager-missing" ? { missingExecutable: "pnpm" } : undefined);
    assert.equal(record.stages.find(stage => stage.key === "runtime-inspection")!.status, "skipped");
    assert.equal(record.artifacts.length, 0);
  }
});


test("source-only Full Scan reaches fresh generation and retention without reading documentation history", async t => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("No provider transport allowed"); });
  const load = createRequire(import.meta.url), now = new Date().toISOString(), impact = transformationImpactFixture();
  const source = impact.provenance.source; source.repository = source.repository.toLowerCase(); source.base = source.head; source.limited = true;
  const text = 'export default function Requests(){return <input aria-label="Title" required/>}';
  const finding = impact.provenance.sourceReferences[0].finding;
  finding.kind = "product-behavior"; finding.before = null; finding.after = null; finding.description = "A request title is required";
  finding.citations = [{ evidenceId: "page", startLine: 1, endLine: 1, excerpt: text }];
  impact.claims[0].before = null; impact.claims[0].after = null; impact.claims[0].description = finding.description;
  impact.provenance.sourceEvidence[0] = { id: "page", path: "app/page.tsx", side: "head", commitId: source.head, contentId: null };
  const analysis: ProductResult = { status: "analyzed", bytes: 0, bundle: { mode: "current-state", repository: source.repository, base: source.head, head: source.head, limited: true, notice: "Bounded source-only fixture",
    inventory: [{ path: "app/page.tsx", previousPath: null, kind: "current-file" }], evidence: [{ id: "page", path: "app/page.tsx", text, side: "head", commitId: source.head, changed: false, status: "available" }] },
    analysis: { assessment: "product-change", findings: [finding], uncertainties: [] } };
  let record = runRecordV2.parse({ schemaVersion: 2, input: { mode: "current-state", owner: "abishek1303", repo: "docsyde", base: source.head, head: source.head, paths: [] }, title: "Full Scan", status: "running", disposition: null, activeStage: null, reason: null, summary: "Running", startedAt: now, finishedAt: null, execution: { token: randomUUID(), heartbeatAt: now, cancelRequestedAt: null }, stages: initialWorkflowStages() });
  let retained: DocumentationChangeProposal | undefined;
  const replacements = [
    ["./run-checkpoints.ts", { writeRunCheckpoint: async (_id: string, _token: string, change: (value: typeof record) => typeof record) => { record = runRecordV2.parse(change(record)); return record; } }],
    ["./run-runtime-config.ts", { loadRunRuntimeConfig: async () => ({ available: false, reason: "no-trusted-workflow" }) }],
    ["../../sources/product-analysis.ts", { captureGenerationContext: async () => ({ repositoryContextUsed: null, runContextUsed: null }), analyzeProductChanges: async () => analysis, synthesizeProductImpact: async () => ({ impact }) }],
    ["../planning/select-documentation-candidates.ts", { selectDocumentationCandidates: async () => { throw new Error("Full Scan must not read documentation history"); } }],
    ["../../../integrations/ai/generate-structured.ts", { generateStructured: async (request: { input: string; invocation: { operation: string } }) => {
      const input = JSON.parse(request.input);
      const data = request.invocation.operation === "documentation-planning" ? (assert.equal(input.objective, "fresh"), assert.equal(input.documents, undefined), { decisions: [transformationDecisionFixture(null, null, "add")], uncertainties: [] })
        : request.invocation.operation === "documentation-transformation" ? { entries: input.authorizations.map((auth: TransformationAuthorization) => transformationEntryFixture(auth, [])) }
          : { verdicts: input.units.map((unit: { id: string }) => ({ unitId: unit.id, verdict: "supported", reason: "Fixture support" })) };
      return { data, model: "mock-no-inference", elapsedMs: 1 };
    } }],
    ["../../../integrations/ai/invocation-log.ts", { validateInvocation: async (_id: unknown, validate: () => unknown) => validate(), finishInvocationValidation: async () => {} }],
    ["../review/review-proposal-operations.ts", { retainDocumentationProposal: async (proposal: DocumentationChangeProposal) => { retained = proposal; } }],
  ] as const;
  const restores: (() => void)[] = [];
  for (const [path, replacement] of replacements) { const resolved = load.resolve(path), original = load(resolved), cached = load.cache[resolved]!; cached.exports = { ...original, ...replacement }; restores.push(() => { cached.exports = original; }); }
  const refreshed = ["../planning/plan-documentation-impact.ts", "../transformation/validate-transformation-grounding.ts", "../transformation/transform-documentation.ts"].map(path => {
    const resolved = load.resolve(path), previous = load.cache[resolved]; delete load.cache[resolved];
    return () => { if (previous) load.cache[resolved] = previous; else delete load.cache[resolved]; };
  });
  t.after(() => refreshed.forEach(restore => restore()));
  const path = load.resolve("./execute-run-workflow.ts"), previous = load.cache[path]; delete load.cache[path];
  t.after(() => { restores.forEach(restore => restore()); if (previous) load.cache[path] = previous; else delete load.cache[path]; });
  const { executeRunWorkflow }: typeof import("./execute-run-workflow") = load(path);
  try { await executeRunWorkflow("fixture", record.execution!.token, new AbortController().signal, async () => {}); }
  catch (error) { throw error instanceof Error && error.cause ? error.cause : error; }
  assert.equal(record.runtime?.outcome, "unavailable"); assert.equal(record.plan?.objective, "fresh");
  assert.ok(retained, JSON.stringify({ reason: record.reason, transformation: record.transformation })); assert.equal(retained.results[0].support, "supported"); assert.equal(retained.candidates.length, 1);
});
