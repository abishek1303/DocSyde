import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDatabase, closeDatabase } from "@/integrations/database/client";
import { documentationDrafts, documentationPublications, documentationPublicationHistory, documentationReviews, documentationRuns } from "@/integrations/database/schema";
import { insertDocumentationRun, mutateDocumentationRun } from "@/integrations/database/documentation-runs";
import { saveDocumentationDraft } from "@/features/documentation/documents/operations";
import { selectDocumentationCandidates } from "@/features/documentation/planning/select-documentation-candidates";
import { retainDocumentationProposal } from "@/features/documentation/review/review-proposal-operations";
import { getPendingWorkspace, getProposalPendingReadiness, publishPendingWorkspace } from "@/features/documentation/review/pending-workspace";
import { getPublication } from "@/features/documentation/publication/publication-operations";
import { finishRetainedRun } from "@/features/documentation/runs/run-checkpoints";
import { runRecordV2 } from "@/features/documentation/runs/run-record";
import { readStoredDocumentationRun } from "@/features/documentation/runs/read-run-record";
import { initialWorkflowStages } from "@/features/documentation/runs/run-workflow-state";
import { transformationImpactFixture, transformationDecisionFixture, transformationEntryFixture } from "./transformation-fixtures";
import { draftFixture } from "./draft-fixture";
import { reviewProposalFixture } from "./review-fixtures";
import type { TransformationAuthorization } from "@/features/documentation/transformation/transformation-input";

test("Full Scan initial creation, destination eligibility, mixed batches and historical zero-actionable outcomes", async t => {
  const name = `scan-${randomUUID()}/product`, repository = `https://github.com/${name}`, owner = name.split("/")[0];
  const oldAllow = process.env.DOCSYDE_ANALYSIS_REPOSITORIES; process.env.DOCSYDE_ANALYSIS_REPOSITORIES = name;
  t.after(async () => { try {
    await getDatabase().delete(documentationReviews).where(eq(documentationReviews.repository, repository));
    await getDatabase().delete(documentationRuns).where(eq(documentationRuns.repository, repository));
    await getDatabase().delete(documentationPublications).where(eq(documentationPublications.repository, repository));
    await getDatabase().delete(documentationPublicationHistory).where(eq(documentationPublicationHistory.repository, repository));
    await getDatabase().delete(documentationDrafts).where(sql`${documentationDrafts.document}->'provenance'->>'repository' = ${repository}`);
  } finally { await closeDatabase(); if (oldAllow === undefined) delete process.env.DOCSYDE_ANALYSIS_REPOSITORIES; else process.env.DOCSYDE_ANALYSIS_REPOSITORIES = oldAllow; } });
  t.mock.method(globalThis, "fetch", () => { throw new Error("No network or inference allowed"); });
  const impact = transformationImpactFixture(2); impact.provenance.source.repository = repository;
  for (let i = 0; i < 12; i++) { const draft = draftFixture(); draft.id = randomUUID(); draft.provenance.repository = repository; await saveDocumentationDraft(draft); }
  const selected = await selectDocumentationCandidates(impact, { publishedOnly: true });
  assert.equal(selected.selection.coverage, "complete"); assert.deepEqual(selected.documents, [], "unpublished snapshots must not consume the live candidate bound");
  const load = createRequire(import.meta.url), restores: (() => void)[] = [];
  let selectRoutes = true;
  const decisions = [transformationDecisionFixture(null, null, "add", ["claim-1"]), transformationDecisionFixture(null, null, "add", ["claim-2"])];
  const replacements = [
    ["../../../src/integrations/ai/generate-structured.ts", { generateStructured: async (request: { input: string; invocation: { operation: string } }) => {
      const input = JSON.parse(request.input), operation = request.invocation.operation;
      const data = operation === "documentation-planning" ? (assert.deepEqual(input.documents, []), { decisions, uncertainties: [] })
        : operation === "documentation-transformation" ? { entries: input.authorizations.map((auth: TransformationAuthorization) => { const entry = transformationEntryFixture(auth, []); if (selectRoutes && entry.change.kind === "add-document") entry.change.associations = auth.associations.map(choice => choice.id); return entry; }) }
        : { verdicts: input.units.map((unit: { id: string; decisionId: string }) => ({ unitId: unit.id, verdict: unit.decisionId === "decision-1" ? "supported" : "unsupported", reason: "Mock decision-specific support verdict" })) };
      return { data, model: "mock-no-inference", elapsedMs: 1 };
    } }],
    ["../../../src/integrations/ai/invocation-log.ts", { validateInvocation: async (_id: unknown, validate: () => unknown) => validate(), finishInvocationValidation: async () => {} }],
    ["../../../src/integrations/ai/generate-composition.ts", { compositionConfigured: () => false }],
  ] as const;
  for (const [path, replacement] of replacements) { const resolved = load.resolve(path), prior = load(resolved), cached = load.cache[resolved]!; cached.exports = { ...prior, ...replacement }; restores.push(() => { cached.exports = prior; }); }
  t.after(() => restores.forEach(restore => restore()));
  const { planDocumentationImpact }: typeof import("@/features/documentation/planning/plan-documentation-impact") = load("../../../src/features/documentation/planning/plan-documentation-impact.ts");
  const { transformDocumentation }: typeof import("@/features/documentation/transformation/transform-documentation") = load("../../../src/features/documentation/transformation/transform-documentation.ts");
  const context = [{ id: "initial-route", kind: "route" as const, value: "/initial", origin: "operator" as const }];
  const { plan } = await planDocumentationImpact({ impact, context, publishedOnly: true });
  const proposal = await transformDocumentation({ impact, plan, context });
  assert.equal(proposal.batches.length, 2); assert.deepEqual(proposal.results.map(result => result.support), ["supported", "unsupported"]);
  assert.equal(proposal.candidates[0].document.schemaVersion, 2);
  const retained = await retainDocumentationProposal(proposal);
  const readiness = await getProposalPendingReadiness(name, proposal.proposalId);
  assert.deepEqual(readiness.actionableDecisionIds, ["decision-1"]); assert.equal(readiness.coverageGaps.length, 1);
  const pending = await getPendingWorkspace({ repository: name });
  assert.equal(pending.count, 1); assert.equal(pending.groups.length, 1); assert.equal(pending.groups[0].changes.length, 1);
  assert.equal(await getPublication({ owner, repo: "product", route: "/initial" }), null, "retention never publishes");
  const now = new Date().toISOString();
  const running = runRecordV2.parse({ schemaVersion: 2, input: { owner, repo: "product", base: impact.provenance.source.base, head: impact.provenance.source.head, paths: [] }, title: "Fixture", status: "running", disposition: null, activeStage: "proposal-retention", reason: null, summary: "Running", startedAt: now, finishedAt: null, execution: { token: randomUUID(), heartbeatAt: now, cancelRequestedAt: null }, stages: initialWorkflowStages().map(stage => ({ ...stage, status: stage.key === "proposal-retention" ? "running" : "completed" })) });
  const pointer = { proposalId: proposal.proposalId, proposalHash: retained.proposalHash, registeredAt: retained.registeredAt, expiresAt: retained.expiresAt };
  assert.equal(finishRetainedRun(running, pointer, readiness).disposition, "awaiting-review");
  const published = await publishPendingWorkspace({ repository: name, expectedHash: pending.hash }); assert.equal(published.status, "published");
  const live = await getPublication({ owner, repo: "product", route: "/initial" }); assert.ok(live);
  const liveSelection = await selectDocumentationCandidates(impact, { publishedOnly: true, context });
  assert.deepEqual(liveSelection.documents.map(document => document.id), [live!.draftId]);

  // An explicit route cannot overwrite the document just published by another batch.
  const occupied = await transformDocumentation({ impact, plan, context }); await retainDocumentationProposal(occupied);
  const occupiedReadiness = await getProposalPendingReadiness(name, occupied.proposalId);
  assert.deepEqual(occupiedReadiness.actionableDecisionIds, []); assert.match(occupiedReadiness.coverageGaps[0], /publication destination/);
  const occupiedState = await retainDocumentationProposal(occupied);
  const zero = finishRetainedRun(running, { ...pointer, proposalId: occupied.proposalId, proposalHash: occupiedState.proposalHash }, occupiedReadiness);
  const zeroRunId = randomUUID(); await insertDocumentationRun(zeroRunId, repository, running);
  await mutateDocumentationRun(zeroRunId, () => ({ status: "running", payload: running }));
  await retainDocumentationProposal(occupied, { runLink: { id: zeroRunId, token: running.execution!.token, async complete(payload, row, database) {
    const eligible = await getProposalPendingReadiness(name, row.id, database);
    return finishRetainedRun(runRecordV2.parse(payload), { proposalId: row.id, proposalHash: row.proposalHash, registeredAt: row.registeredAt.toISOString(), expiresAt: row.expiresAt.toISOString() }, eligible);
  } } });
  const atomicZero = await readStoredDocumentationRun(zeroRunId); assert.ok(atomicZero && "schemaVersion" in atomicZero.record); assert.equal(atomicZero.record.disposition, "incomplete");
  assert.equal(zero.disposition, "incomplete"); assert.equal(zero.reason, "proposal-no-publishable-updates"); assert.ok(zero.retainedProposal);
  assert.equal((await getPendingWorkspace({ repository: name })).count, 0);
  assert.equal((await getPublication({ owner, repo: "product", route: "/initial" }))!.draftId, live!.draftId);
  assert.equal(runRecordV2.safeParse({ ...zero, disposition: "awaiting-review" }).success, false);

  selectRoutes = false;
  const unusedRoute = await transformDocumentation({ impact, plan, context: [{ ...context[0], value: "/not-selected" }] }); await retainDocumentationProposal(unusedRoute);
  const unusedReadiness = await getProposalPendingReadiness(name, unusedRoute.proposalId);
  assert.deepEqual(unusedReadiness.actionableDecisionIds, []); assert.match(unusedReadiness.coverageGaps[0], /does not select/);
  const missing = await transformDocumentation({ impact, plan }); await retainDocumentationProposal(missing);
  assert.deepEqual((await getProposalPendingReadiness(name, missing.proposalId)).actionableDecisionIds, [], "no route is invented");
  // Historical records remain readable, but a stale optimistic label cannot create a review CTA.
  const old = { ...zero, disposition: "awaiting-review", reason: "proposal-retained-awaiting-human-review" }; delete old.reviewReadiness;
  const id = randomUUID(); await insertDocumentationRun(id, repository, old); await mutateDocumentationRun(id, () => ({ status: "finished", payload: old }));
  const reread = await readStoredDocumentationRun(id); assert.ok(reread && "schemaVersion" in reread.record);
  assert.equal(reread.record.disposition, "incomplete");
  const draft = draftFixture(); draft.id = randomUUID(); draft.provenance.repository = repository; await saveDocumentationDraft(draft);
  const unsupportedDestination = reviewProposalFixture(draft, false); await retainDocumentationProposal(unsupportedDestination);
  assert.equal((await getProposalPendingReadiness(name, unsupportedDestination.proposalId)).actionableDecisionIds.length, 1, "an explicit unoccupied baseline route remains supported by the existing contract");
});
