import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { getDatabase, closeDatabase } from "@/integrations/database/client";
import { documentationDrafts, documentationReviews, documentationPublications, documentationPublicationHistory } from "@/integrations/database/schema";
import { saveDocumentationDraft } from "@/features/documentation/documents/operations";
import { publishDocumentation, getPublication } from "@/features/documentation/publication/publication-operations";
import { retainDocumentationProposal, getDocumentationReview } from "@/features/documentation/review/review-proposal-operations";
import { getPendingWorkspace, hasActionablePendingChanges } from "@/features/documentation/review/pending-workspace";
import { PendingReviewConflict, assertRunReviewEligible } from "@/features/documentation/review/run-eligibility";
import { createFullScanRun, createBranchDocumentationRun } from "@/features/documentation/runs/prepare-run";
import { draftFixture } from "./draft-fixture";
import { reviewProposalFixture } from "./review-fixtures";

class Redirect extends Error { constructor(readonly location: string) { super("Fixture redirect"); } }
test("confirmed fresh-scan recovery discards only the observed project batch and returns to guarded setup", async t => {
  const owner = `recovery-${randomUUID()}`, repository = `${owner}/product`, other = `${owner}/other`;
  const locations = [`https://github.com/${repository}`, `https://github.com/${other}`];
  const priorAllow = process.env.DOCSYDE_ANALYSIS_REPOSITORIES; process.env.DOCSYDE_ANALYSIS_REPOSITORIES = `${repository},${other}`;
  t.after(async () => { try {
    await getDatabase().delete(documentationReviews).where(inArray(documentationReviews.repository, locations));
    await getDatabase().delete(documentationPublications).where(inArray(documentationPublications.repository, locations));
    await getDatabase().delete(documentationPublicationHistory).where(inArray(documentationPublicationHistory.repository, locations));
    await getDatabase().delete(documentationDrafts).where(sql`${documentationDrafts.document}->'provenance'->>'repository' IN (${locations[0]}, ${locations[1]})`);
  } finally { await closeDatabase(); if (priorAllow === undefined) delete process.env.DOCSYDE_ANALYSIS_REPOSITORIES; else process.env.DOCSYDE_ANALYSIS_REPOSITORIES = priorAllow; } });
  const load = createRequire(import.meta.url), resets: (() => void)[] = [];
  for (const [moduleName, exports] of [["next/navigation", { redirect: (location: string) => { throw new Redirect(location); } }], ["next/cache", { revalidatePath: () => {} }]] as const) {
    const path = load.resolve(moduleName), prior = load.cache[path];
    const stub = new Module(path); stub.exports = exports; load.cache[path] = stub;
    resets.push(() => { if (prior) load.cache[path] = prior; else delete load.cache[path]; });
  }
  const actionPath = load.resolve("../../../src/app/runs/actions.ts"), priorActions = load.cache[actionPath]; delete load.cache[actionPath];
  t.after(() => { resets.forEach(reset => reset()); if (priorActions) load.cache[actionPath] = priorActions; else delete load.cache[actionPath]; });
  const { discardForFullScan, startFullScan, startBranchRun }: typeof import("@/app/runs/actions") = load(actionPath);
  const network = t.mock.method(globalThis, "fetch", () => { throw new Error("Recovery must not read source or invoke inference"); });
  const baseline = draftFixture(); baseline.provenance.repository = locations[0]; await saveDocumentationDraft(baseline);
  const initial = await publishDocumentation({ owner, repo: "product", route: "/requests/new", draftId: baseline.id });
  const current = structuredClone(baseline); current.id = randomUUID(); await saveDocumentationDraft(current);
  await publishDocumentation({ owner, repo: "product", route: "/requests/new", draftId: current.id, observedId: initial.publication!.id });
  const live = await getPublication({ owner, repo: "product", route: "/requests/new" });
  const archive = await getDatabase().select().from(documentationPublicationHistory).where(eq(documentationPublicationHistory.repository, locations[0])); assert.equal(archive.length, 1);
  const proposal = reviewProposalFixture(current, false); await retainDocumentationProposal(proposal);
  const otherBaseline = draftFixture(); otherBaseline.provenance.repository = locations[1]; await saveDocumentationDraft(otherBaseline);
  const independent = reviewProposalFixture(otherBaseline, false); await retainDocumentationProposal(independent);
  const observed = await getPendingWorkspace({ repository }); assert.equal(observed.count, 1);
  const form = (hash = observed.hash, selected = repository) => { const data = new FormData(); data.set("repository", selected); data.set("branch", "main"); data.set("expectedHash", hash); return data; };
  assert.ok((await discardForFullScan({}, form())).error, "server requires explicit confirmation");
  assert.equal((await getDocumentationReview(proposal.proposalId)).status, "found");
  const untouched = await getDocumentationReview(proposal.proposalId); if (untouched.status === "found") assert.equal(untouched.review, null);
  const wrongProject = form(observed.hash, other); wrongProject.set("confirmed", "on");
  assert.ok((await discardForFullScan({}, wrongProject)).error, "a different project's hash cannot authorize discard");
  const start = form();
  assert.equal((await startFullScan({}, start)).code, "pending-review"); assert.equal((await startBranchRun({}, start)).code, "pending-review");
  await assert.rejects(createFullScanRun({ repository, branch: "main" }), PendingReviewConflict);
  await assert.rejects(createBranchDocumentationRun({ repository, branch: "main" }), PendingReviewConflict);
  // A new independent proposal arriving after confirmation was displayed invalidates that confirmation.
  const arrived = reviewProposalFixture(current, false, 1); await retainDocumentationProposal(arrived);
  const stale = form(); stale.set("confirmed", "on"); assert.ok((await discardForFullScan({}, stale)).error);
  assert.equal((await getPendingWorkspace({ repository })).count, 2);
  const updated = await getPendingWorkspace({ repository });
  const confirmed = () => { const data = form(updated.hash); data.set("confirmed", "on"); return data; };
  const outcomes = await Promise.allSettled([discardForFullScan({}, confirmed()), discardForFullScan({}, confirmed())]);
  const redirects = outcomes.filter(result => result.status === "rejected" && result.reason instanceof Redirect);
  assert.equal(redirects.length, 1, "only one concurrent recovery can finalize the observed batch");
  const redirected = redirects[0]; assert.ok(redirected.status === "rejected");
  const destination = new URL(redirected.reason.location, "http://fixture");
  assert.equal(destination.pathname, "/runs/new"); assert.equal(destination.searchParams.get("mode"), "full");
  assert.equal(destination.searchParams.get("repository"), repository); assert.equal(destination.searchParams.get("branch"), "main");
  assert.equal(await hasActionablePendingChanges(repository), false); await assertRunReviewEligible(repository);
  assert.equal(await hasActionablePendingChanges(other), true, "other projects stay unchanged");
  for (const id of [proposal.proposalId, arrived.proposalId]) { const audit = await getDocumentationReview(id); assert.equal(audit.status, "found"); if (audit.status === "found") assert.deepEqual(audit.review?.exclusions?.map(item => item.decisionId), ["decision-1"]); }
  assert.deepEqual(await getPublication({ owner, repo: "product", route: "/requests/new" }), live);
  assert.deepEqual(await getDatabase().select().from(documentationPublicationHistory).where(eq(documentationPublicationHistory.repository, locations[0])), archive);
  // A batch created after recovery is never discarded by replaying the old confirmation.
  const future = reviewProposalFixture(current, false); await retainDocumentationProposal(future);
  assert.ok((await discardForFullScan({}, confirmed())).error);
  assert.equal((await getPendingWorkspace({ repository })).count, 1);
  await assert.rejects(createFullScanRun({ repository, branch: "main" }), PendingReviewConflict, "setup does not reserve or bypass future admission");
  assert.equal(network.mock.callCount(), 0);
});
