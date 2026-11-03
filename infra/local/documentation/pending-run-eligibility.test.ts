import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { randomUUID } from "node:crypto";
import { eq, sql, inArray } from "drizzle-orm";
import { getDatabase, closeDatabase } from "@/integrations/database/client";
import { documentationDrafts, documentationReviews, documentationPublications, documentationPublicationHistory, documentationRuns } from "@/integrations/database/schema";
import { insertDocumentationRun, admitDocumentationRun, mutateDocumentationRun, findDocumentationRun } from "@/integrations/database/documentation-runs";
import { validateDocumentationDocument } from "@/features/documentation/documents/document-validation";
import { saveDocumentationDraft } from "@/features/documentation/documents/operations";
import { publishDocumentation, getPublication } from "@/features/documentation/publication/publication-operations";
import { retainDocumentationProposal, getDocumentationReview } from "@/features/documentation/review/review-proposal-operations";
import { hasActionablePendingChanges, getPendingWorkspace, publishPendingWorkspace, discardPendingWorkspace } from "@/features/documentation/review/pending-workspace";
import { assertRunReviewEligible, PendingReviewConflict, PENDING_REVIEW_MESSAGE } from "@/features/documentation/review/run-eligibility";
import { applyDocumentationReview } from "@/features/documentation/review/apply-documentation-review";
import { createDocumentationRun } from "@/features/documentation/runs/run-operations";
import { createFullScanRun, createBranchDocumentationRun } from "@/features/documentation/runs/prepare-run";
import { stopRunCoordinator } from "@/features/documentation/runs/run-coordinator";
import { runRecordV2 } from "@/features/documentation/runs/run-record";
import { finishRun } from "@/features/documentation/runs/run-checkpoints";
import { initialWorkflowStages } from "@/features/documentation/runs/run-workflow-state";
import { POST } from "@/app/runs/[id]/execute/route";
import { draftFixture } from "./draft-fixture";
import { reviewProposalFixture } from "./review-fixtures";

test("project review lifecycle gates both modes and atomic admission; publish/discard restore eligibility without touching other projects", async t => {
  const owner = `reviewgate-${randomUUID()}`, repository = `${owner}/product`, other = `${owner}/other`, location = `https://github.com/${repository}`;
  const previous = process.env.DOCSYDE_ANALYSIS_REPOSITORIES;
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = `${repository},${other}`;
  const repositories = [location, `https://github.com/${other}`];
  t.after(async () => {
    try {
      await stopRunCoordinator();
      await getDatabase().delete(documentationReviews).where(inArray(documentationReviews.repository, repositories));
      await getDatabase().delete(documentationRuns).where(inArray(documentationRuns.repository, repositories));
      await getDatabase().delete(documentationPublications).where(inArray(documentationPublications.repository, repositories));
      await getDatabase().delete(documentationPublicationHistory).where(inArray(documentationPublicationHistory.repository, repositories));
      await getDatabase().delete(documentationDrafts).where(sql`${documentationDrafts.document}->'provenance'->>'repository' IN (${location}, ${repositories[1]})`);
    } finally { await closeDatabase(); if (previous === undefined) delete process.env.DOCSYDE_ANALYSIS_REPOSITORIES; else process.env.DOCSYDE_ANALYSIS_REPOSITORIES = previous; }
  });
  const load = createRequire(import.meta.url), navigation = load.resolve("next/navigation"), previousNavigation = load.cache[navigation];
  const navigationStub = new Module(navigation); navigationStub.exports = { redirect: () => { throw new Error("A blocked action must not redirect"); } }; load.cache[navigation] = navigationStub;
  t.after(() => { if (previousNavigation) load.cache[navigation] = previousNavigation; else delete load.cache[navigation]; });
  const { startFullScan, startBranchRun }: typeof import("@/app/runs/actions") = load("../../../src/app/runs/actions.ts");
  const network = t.mock.method(globalThis, "fetch", () => { throw new Error("No source reads or inference permitted in eligibility fixtures"); });
  const input = { owner, repo: "product", base: "a".repeat(40), head: "b".repeat(40), paths: [] };
  const pending = () => runRecordV2.parse({ schemaVersion: 2, input, title: "Fixture", status: "pending", disposition: null, activeStage: null, reason: null, execution: null, summary: "Ready", startedAt: null, finishedAt: null, stages: initialWorkflowStages() });
  const firstRun = randomUUID(), secondRun = randomUUID();
  await insertDocumentationRun(firstRun, location, pending()); await insertDocumentationRun(secondRun, location, pending());
  assert.equal(await hasActionablePendingChanges(repository), false);
  const baseline = draftFixture(); baseline.provenance.repository = location;
  await saveDocumentationDraft(baseline);
  await publishDocumentation({ owner, repo: "product", route: "/requests/new", draftId: baseline.id });
  const proposal = reviewProposalFixture(baseline, false); await retainDocumentationProposal(proposal);
  const liveBefore = await getPublication({ owner, repo: "product", route: "/requests/new" });
  assert.equal(await hasActionablePendingChanges(repository), true);
  await assert.rejects(assertRunReviewEligible(repository), PendingReviewConflict);
  assert.equal(await hasActionablePendingChanges(other), false); await assertRunReviewEligible(other);
  await assert.rejects(createDocumentationRun(input), PendingReviewConflict);
  await assert.rejects(createFullScanRun({ repository, branch: "main" }), PendingReviewConflict);
  await assert.rejects(createBranchDocumentationRun({ repository, branch: "main" }), PendingReviewConflict);
  const form = new FormData(); form.set("repository", repository); form.set("branch", "main");
  for (const action of [startFullScan, startBranchRun]) assert.deepEqual(await action({}, form), { error: PENDING_REVIEW_MESSAGE, code: "pending-review" });
  const response = await POST(new Request(`http://localhost/runs/${firstRun}/execute`, { method: "POST", headers: { origin: "http://localhost", host: "localhost" } }), { params: Promise.resolve({ id: firstRun }) });
  assert.equal(response.status, 409); assert.equal((await response.json()).code, "pending-review");
  assert.equal((await findDocumentationRun(firstRun))!.status, "pending");
  const otherBaseline = draftFixture(); otherBaseline.provenance.repository = repositories[1];
  await saveDocumentationDraft(otherBaseline); await publishDocumentation({ owner, repo: "other", route: "/requests/new", draftId: otherBaseline.id });
  const otherProposal = reviewProposalFixture(otherBaseline, false); await retainDocumentationProposal(otherProposal);
  const view = await getPendingWorkspace({ repository }); assert.equal(view.count, 1);
  assert.equal((await publishPendingWorkspace({ repository, expectedHash: view.hash })).status, "published");
  assert.equal(await hasActionablePendingChanges(repository), false, "publishing clears eligibility");
  assert.equal(await hasActionablePendingChanges(other), true, "another project retains its independent pending batch");
  const current = (await getDatabase().select().from(documentationDrafts).where(eq(documentationDrafts.id, (await getPublication({ owner, repo: "product", route: "/requests/new" }))!.draftId)))[0];
  const nextProposal = reviewProposalFixture(validateDocumentationDocument(current.document), false); const retained = await retainDocumentationProposal(nextProposal);
  const accepted = await applyDocumentationReview({ proposalId: nextProposal.proposalId, expectedProposalHash: retained.proposalHash, decisions: [{ decisionId: "decision-1", choice: "approve" }], publications: [] });
  const live = await getPublication({ owner, repo: "product", route: "/requests/new" });
  assert.equal(await hasActionablePendingChanges(repository), true);
  const toDiscard = await getPendingWorkspace({ repository });
  assert.equal((await discardPendingWorkspace({ repository, expectedHash: toDiscard.hash })).status, "unavailable", "confirmation is required");
  assert.equal(await hasActionablePendingChanges(repository), true);
  assert.equal((await discardPendingWorkspace({ repository, expectedHash: toDiscard.hash, confirmed: true })).status, "discarded");
  assert.equal(await hasActionablePendingChanges(repository), false);
  assert.deepEqual(await getPublication({ owner, repo: "product", route: "/requests/new" }), live);
  assert.notEqual(live!.draftId, liveBefore!.draftId, "only explicit publication changed live docs");
  const audit = await getDocumentationReview(nextProposal.proposalId);
  assert.equal(audit.status, "found");
  if (audit.status === "found") { assert.equal(audit.review!.selectionHash, accepted.review!.selectionHash); assert.equal(audit.review!.exclusions?.[0].decisionId, "decision-1"); }
  assert.equal(await hasActionablePendingChanges(other), true, "discard touches only the selected project");
  assert.equal((await getDocumentationReview(otherProposal.proposalId)).status, "found");
  const rejected = reviewProposalFixture(validateDocumentationDocument(current.document), false), rejectedRetained = await retainDocumentationProposal(rejected);
  await applyDocumentationReview({ proposalId: rejected.proposalId, expectedProposalHash: rejectedRetained.proposalHash, decisions: [{ decisionId: "decision-1", choice: "reject" }], publications: [] });
  assert.equal(await hasActionablePendingChanges(repository), false, "rejected receipts do not block");
  const expired = reviewProposalFixture(validateDocumentationDocument(current.document), false); await retainDocumentationProposal(expired, { lifetimeMs: 1 });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(await hasActionablePendingChanges(repository), false, "expired, published and excluded records do not block");
  assert.equal((await getPendingWorkspace({ repository })).groups.length, 0, "only actionable proposals appear in Pending Changes");
  assert.equal((await getDocumentationReview(expired.proposalId)).status, "found", "historical evidence remains readable in its retained review");
  const claim = (row: NonNullable<Awaited<ReturnType<typeof findDocumentationRun>>>) => {
    const record = runRecordV2.parse(row.payload), now = new Date().toISOString();
    return { status: "running", payload: runRecordV2.parse({ ...record, status: "running", startedAt: now, execution: { token: randomUUID(), heartbeatAt: now, cancelRequestedAt: null } }) };
  };
  const admissions = await Promise.all([firstRun, secondRun].map(id => admitDocumentationRun(id, location, claim, database => assertRunReviewEligible(repository, database))));
  assert.deepEqual(admissions.sort(), ["busy", "claimed"]);
  for (const id of [firstRun, secondRun]) await mutateDocumentationRun(id, row => ({ status: "finished", payload: finishRun(runRecordV2.parse(row.payload), "cancelled", "fixture-cleanup") }));
  assert.equal(network.mock.callCount(), 0);
  // A proposal appearing after setup's early check still blocks the atomic insert.
  let sourceReads = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input); assert.equal(url.origin, "https://api.github.com");
    if (++sourceReads === 3) await retainDocumentationProposal(reviewProposalFixture(validateDocumentationDocument(current.document), false));
    return Response.json({ sha: "b".repeat(40), html_url: `https://github.com/${repository}/commit/${"b".repeat(40)}`, parents: [{ sha: "a".repeat(40) }], commit: { message: "Mock current revision", author: { name: "Fixture" }, committer: { date: "2026-11-01T00:00:00Z" } } });
  });
  const oldToken = process.env.GITHUB_TOKEN; process.env.GITHUB_TOKEN = "fixture";
  try { await assert.rejects(createFullScanRun({ repository, branch: "main" }), PendingReviewConflict); }
  finally { if (oldToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = oldToken; }
  assert.equal(sourceReads, 3);
  assert.equal((await getDatabase().select().from(documentationRuns).where(eq(documentationRuns.repository, location))).length, 2, "the raced creation inserts no new run");

});
