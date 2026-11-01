import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import { closeDatabase } from "@/integrations/database/client";
import { createLocalStorage } from "@/integrations/storage/local-storage";
import { runRecordV2 } from "@/features/documentation/run-record";
import { runView } from "@/features/documentation/run-operations";
import { initialWorkflowStages } from "@/features/documentation/run-workflow-state";
import { documentationHash } from "@/features/documentation/document-identity";
import { serializeProductEvidence } from "@/features/sources/analysis/product-change-evidence";
import { shortResponse } from "@/features/documentation/run-stage-response";
import { projectStageResponsePreviews } from "@/features/documentation/run-response-projection";
import { getRunStageResponse, serializeStageResponse } from "@/features/documentation/read-run-stage-response";
import { stopRunCoordinator } from "@/features/documentation/run-coordinator";
import { GET } from "@/app/runs/[id]/responses/[stage]/route";
import { reviewProposalFixture } from "./review-fixtures";

test("stage response reads use validated saved outputs, enforce access/integrity and never invoke providers", async t => {
  const env = { DATABASE_URL: process.env.DATABASE_URL, DOCSYDE_ANALYSIS_REPOSITORIES: process.env.DOCSYDE_ANALYSIS_REPOSITORIES, DOCSYDE_STORAGE_DIRECTORY: process.env.DOCSYDE_STORAGE_DIRECTORY };
  const directory = await mkdtemp(join(tmpdir(), "docsyde-response-"));
  process.env.DATABASE_URL = "postgres://fixture:fixture@localhost/fixture";
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "abishek1303/DocSyde";
  process.env.DOCSYDE_STORAGE_DIRECTORY = directory;
  t.after(async () => { await stopRunCoordinator(); await closeDatabase(); await rm(directory, { recursive: true, force: true }); for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const providers = t.mock.fn(() => { throw new Error("Response inspection must not call providers"); });
  t.mock.method(globalThis, "fetch", providers);
  const proposal = reviewProposalFixture(), id = randomUUID(), now = new Date().toISOString();
  const impact = proposal.impact, repository = impact.provenance.source.repository.toLowerCase();
  const bundle = { repository, base: impact.provenance.source.base, head: impact.provenance.source.head, inventory: [{ path: "form.ts", previousPath: null, kind: "modified" }], evidence: [{ id: "patch-1", path: "form.ts", side: "patch" as const, commitId: null, text: "+required\nSECRET_SOURCE_BUNDLE", status: "included", changed: true }], limited: false, notice: "Private source context" };
  const analysis = { bundle, bytes: Buffer.byteLength(serializeProductEvidence(bundle)), status: "analyzed" as const, model: "test-source", elapsedMs: 1, analysis: { assessment: "product-change" as const, findings: impact.provenance.sourceReferences.map(ref => ref.finding), uncertainties: [] } };
  const checkpointId = randomUUID(), imageKey = randomUUID();
  const visual = { selection: { model: "test-selection", selection: { decision: "analyze", reason: "Inspect the requirement", selected: [{ checkpointId, sourceRefs: ["source-1"], reason: "Visible field", question: "Is the title required?" }], uncertainties: [] } }, runtime: [{ captureId: checkpointId, requestedPathname: "/requests/new", finalPathname: "/requests/new", capturedAt: now, screenshotSha256: "f".repeat(64), artifactKey: imageKey, vision: { model: "test-vision", elapsedMs: 1, data: { elements: [], observations: ["Title is marked required"], limitations: [] } } }], summary: { private: "SECRET_RUNTIME_INPUT" } };
  const bytes = Buffer.from(JSON.stringify(visual)), artifact = await createLocalStorage(directory).store(bytes);
  const record = runRecordV2.parse({ schemaVersion: 2, input: { owner: "abishek1303", repo: "DocSyde", base: bundle.base, head: bundle.head, paths: [], runContext: "PRIVATE_RUN_CONTEXT" }, title: "Change", status: "finished", disposition: "awaiting-review", reason: "proposal-retained-awaiting-human-review", summary: "Review ready", activeStage: null, startedAt: now, finishedAt: now, execution: null,
    stages: initialWorkflowStages().map(stage => ({ ...stage, status: "completed", startedAt: now, finishedAt: now })), analysis, analysisSha256: documentationHash(analysis), impact, plan: proposal.plan,
    decision: { status: "not-needed", reason: "Source evidence is sufficient", staticEvidence: "sufficient", targets: [], uncertainties: [] },
    runtimeResponsePreview: "Inspect the requirement", artifacts: [{ kind: "runtime-analysis", key: artifact.key, sha256: createHash("sha256").update(bytes).digest("hex") }],
    transformation: { responsePreview: "A request title is required.", proposalId: proposal.proposalId, sha256: documentationHash(proposal), status: proposal.status, results: proposal.results.map(result => ({ decisionId: result.decisionId, generation: result.generation, support: result.support, reviewReady: result.reviewReady, materialization: result.materialization, approval: result.approval, saveCompatible: result.saveCompatible, issues: result.issues, model: result.model, candidateId: result.candidateId })), batches: proposal.batches, supportModel: proposal.supportModel, supportAttempted: proposal.supportAttempted },
    retainedProposal: { proposalId: proposal.proposalId, proposalHash: documentationHash(proposal), registeredAt: now, expiresAt: new Date(Date.now() + 60000).toISOString() }, models: [{ stage: "source-analysis", model: "test-source", elapsedMs: 1 }] });
  let queries = 0;
  t.mock.method(Pool.prototype, "query", async (query: { text: string }, params: unknown[]) => {
    queries++;
    assert.ok(query.text.startsWith("select"), "Response reads must not write");
    if (query.text.includes('"documentation_proposal_reviews"')) return { rows: [[proposal.proposalId, repository, documentationHash(proposal), proposal, [], now, new Date(Date.now() + 60000).toISOString(), null]] };
    if (params[0] === id) return { rows: [[id, repository, record.status, record, now, now]] };
    return { rows: [] };
  });
  const previews = projectStageResponsePreviews(record);
  assert.equal(previews.find(entry => entry.stage === "prepare-context")?.status, "not-used");
  assert.equal(previews.find(entry => entry.stage === "runtime-decision")?.kind, "result");
  assert.equal(runView({ id, record, createdAt: now, savedAt: null }, { includeResponses: false }).responses, undefined);
  for (const stage of ["source-analysis", "runtime-decision", "runtime-inspection", "impact-synthesis", "documentation-planning", "documentation-transformation"]) {
    const response = await getRunStageResponse(id, stage);
    assert.ok(response?.status === "available");
    for (const hidden of ["SECRET_SOURCE_BUNDLE", "SECRET_RUNTIME_INPUT", "PRIVATE_RUN_CONTEXT", imageKey, "authorizations", '"provenance"', '"candidates"']) assert.ok(!response.text.includes(hidden), `Do not expose ${hidden}`);
    if (stage === "documentation-transformation") assert.ok(response.text.includes("A request title is required."));
    if (stage === "runtime-inspection") assert.deepEqual(response.models, ["test-selection", "test-vision"]);
  }
  const retained = await getRunStageResponse(id, "proposal-retention");
  assert.equal(retained?.status, "not-used");
  const count = queries;
  await assert.rejects(() => getRunStageResponse(id, "../../secrets"));
  assert.equal(queries, count);
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "other/repo";
  await assert.rejects(() => getRunStageResponse(id, "source-analysis"), /not allowed/);
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "abishek1303/DocSyde";
  await writeFile(join(directory, artifact.key), "PRIVATE_CORRUPT_ARTIFACT");
  const failed = await GET(new Request("http://localhost/"), { params: Promise.resolve({ id, stage: "runtime-inspection" }) });
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.ok(!(await failed.text()).includes("PRIVATE_CORRUPT_ARTIFACT"));
  assert.ok(record.transformation);
  record.transformation.sha256 = "0".repeat(64);
  await assert.rejects(() => getRunStageResponse(id, "documentation-transformation"), /identity mismatch/);
  assert.equal(providers.mock.callCount(), 0);
});

test("previews are short, unavailable stages stay honest, and full responses are bounded", () => {
  assert.equal(shortResponse("  A\n short response  "), "A short response");
  const long = "x".repeat(800);
  assert.equal(shortResponse(long), `${"x".repeat(240)}…`);
  assert.throws(() => serializeStageResponse({ response: "x".repeat(256 * 1024) }, []), /display bound/);
  const record = runRecordV2.parse({ schemaVersion: 2, input: { owner: "example", repo: "product", base: "a".repeat(40), head: "b".repeat(40), paths: [] }, title: "Change", status: "pending", disposition: null, reason: null, activeStage: null, summary: "Ready", startedAt: null, finishedAt: null, execution: null, stages: initialWorkflowStages() });
  assert.equal(projectStageResponsePreviews(record).find(entry => entry.stage === "source-analysis")?.status, "pending");
  const old = runRecordV2.parse({ ...record, status: "finished", disposition: "failed", finishedAt: new Date().toISOString(), stages: record.stages.map(stage => ({ ...stage, status: "failed" })) });
  assert.equal(projectStageResponsePreviews(old).find(entry => entry.stage === "source-analysis")?.status, "unavailable");
});
