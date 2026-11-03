import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDatabase, closeDatabase } from "@/integrations/database/client";
import { documentationDrafts, documentationReviews, documentationPublications, documentationPublicationHistory } from "@/integrations/database/schema";
import { saveDocumentationDraft } from "@/features/documentation/documents/operations";
import { publishDocumentation, getPublication, getContextualDocumentation } from "@/features/documentation/publication/publication-operations";
import { retainDocumentationProposal, getDocumentationReview, readRetainedReview } from "@/features/documentation/review/review-proposal-operations";
import { getPendingWorkspace, publishPendingWorkspace } from "@/features/documentation/review/pending-workspace";
import { applyDocumentationReview } from "@/features/documentation/review/apply-documentation-review";
import { documentationReviewBatchTransaction, findDocumentationReview } from "@/integrations/database/documentation-reviews";
import { queryProductKnowledge } from "@/features/documentation/knowledge/product-knowledge";
import { materializePendingEdits } from "@/features/documentation/review/pending-materialization";
import { draftFixture } from "./draft-fixture";
import { reviewProposalFixture } from "./review-fixtures";

test("consolidated pending publication preserves grounding, atomicity and current knowledge", async t => {
 const owner = `pending-${randomUUID()}`, repository = `${owner}/product`, location = `https://github.com/${repository}`;
 const before = process.env.DOCSYDE_ANALYSIS_REPOSITORIES; process.env.DOCSYDE_ANALYSIS_REPOSITORIES = repository;
 t.after(async () => { try {
  await getDatabase().delete(documentationReviews).where(eq(documentationReviews.repository, location));
  await getDatabase().delete(documentationPublications).where(eq(documentationPublications.repository, location));
  await getDatabase().delete(documentationPublicationHistory).where(eq(documentationPublicationHistory.repository, location));
  await getDatabase().delete(documentationDrafts).where(sql`${documentationDrafts.document}->'provenance'->>'repository' = ${location}`);
 } finally { await closeDatabase(); if(before===undefined)delete process.env.DOCSYDE_ANALYSIS_REPOSITORIES;else process.env.DOCSYDE_ANALYSIS_REPOSITORIES=before; } });
 const baseline = draftFixture(); baseline.provenance.repository = location;
 await saveDocumentationDraft(baseline);
 const initial = await publishDocumentation({ owner, repo: "product", route: "/requests/new", draftId: baseline.id }); assert.equal(initial.status,"published");
 const first = reviewProposalFixture(baseline,false), second = reviewProposalFixture(baseline,false,1);
 const unsupported = structuredClone(first); unsupported.results[0].support = "unsupported";
 assert.throws(() => materializePendingEdits([{proposal:unsupported,results:unsupported.results}],baseline));
 const combined = materializePendingEdits([{proposal:first,results:first.results},{proposal:second,results:second.results}],baseline);
 assert.equal(combined.sections.length,baseline.sections.length);
 assert.notDeepEqual(combined.sections[0].content,baseline.sections[0].content);
 assert.notDeepEqual(combined.sections[1].content,baseline.sections[1].content);
 assert.equal(combined.schemaVersion,2);
 await retainDocumentationProposal(first); await retainDocumentationProposal(second);
 let view = await getPendingWorkspace({repository}); assert.equal(view.count,2); assert.equal(view.blocked,false); assert.equal(view.groups.length,1); assert.equal(view.groups[0].highlighted.length,2);
 const rejected=view.groups[0].changes[1].key;
 const subset=await getPendingWorkspace({repository,excluded:[rejected]}); assert.equal(subset.count,1); assert.equal(subset.groups[0].highlighted.length,1);
 const undone=await getPendingWorkspace({repository}); assert.equal(undone.count,2); assert.deepEqual(undone.groups[0].document,view.groups[0].document);
 assert.equal((await getPublication({owner,repo:"product",route:"/requests/new"}))!.draftId,baseline.id);
 const agentBefore=await queryProductKnowledge("get_documentation",{repository,route:"/requests/new"}); assert.equal(agentBefore.documents[0].documentId,baseline.id);
 // A late write failure rolls back saves, publication replacement, archive, and receipt together.
 await assert.rejects(documentationReviewBatchTransaction([first.proposalId],async scopes=>{
  const scope=scopes[0]; await scope.save(combined.id,combined);
  await scope.replacePublication(location,"/requests/new",combined.id,initial.publication!.id,baseline.id);
  throw Error("controlled late failure");
 }));
 assert.equal((await getPublication({owner,repo:"product",route:"/requests/new"}))!.draftId,baseline.id);
 assert.equal((await getDatabase().select().from(documentationPublicationHistory).where(eq(documentationPublicationHistory.repository,location))).length,0);
 assert.equal((await getDatabase().select().from(documentationDrafts).where(eq(documentationDrafts.id,combined.id))).length,0);
 const overlap=reviewProposalFixture(baseline,false); await retainDocumentationProposal(overlap);
 view=await getPendingWorkspace({repository}); assert.equal(view.blocked,true);
 assert.equal((await publishPendingWorkspace({repository,expectedHash:view.hash})).status,"blocked");
 const overlapKey=view.groups[0].changes.find(change=>change.proposalId===overlap.proposalId)!.key;
 view=await getPendingWorkspace({repository,excluded:[overlapKey]}); assert.equal(view.blocked,false);
 const result=await publishPendingWorkspace({repository,excluded:[overlapKey],expectedHash:view.hash}); assert.equal(result.status,"published"); assert.equal(result.count,2);
 assert.equal((await publishPendingWorkspace({repository,excluded:[overlapKey],expectedHash:view.hash})).status,"changed", "a repeated old batch cannot manufacture more versions");
 const live=await getPublication({owner,repo:"product",route:"/requests/new"}); assert.notEqual(live!.draftId,baseline.id);
 for(const proposal of [first,second]) { const review=await getDocumentationReview(proposal.proposalId); assert.equal(review.status,"found");if(review.status==="found") {assert.equal(review.review!.publications[0].actualDocumentId,live!.draftId);assert.equal(review.review!.selection.decisions[0].choice,"approve");} }
 const retainedRow=(await findDocumentationReview(first.proposalId))!;
 const badReceipt=structuredClone(retainedRow);const badReview=structuredClone((await getDocumentationReview(first.proposalId)));
 if(badReview.status==="found") { badReview.review!.publications[0].decisionIds=["decision-8"];badReceipt.review=badReview.review;assert.throws(()=>readRetainedReview(badReceipt));
   const historical=structuredClone(retainedRow);const historicalReview=structuredClone(readRetainedReview(retainedRow).review!);delete historicalReview.publications[0].decisionIds;delete historicalReview.publications[0].excludedDecisionIds;historical.review=historicalReview;assert.doesNotThrow(()=>readRetainedReview(historical)); }
 const rejectedReview=await getDocumentationReview(overlap.proposalId); if(rejectedReview.status==="found")assert.equal(rejectedReview.review!.selection.decisions[0].choice,"reject");
 assert.equal((await getPendingWorkspace({repository})).groups.length,0);
 assert.equal((await getContextualDocumentation({owner,repo:"product",route:"/requests/new"})).publication!.documentId,live!.draftId);
 assert.equal((await queryProductKnowledge("get_documentation",{repository,route:"/requests/new"})).documents[0].documentId,live!.draftId);
 assert.equal((await getDatabase().select().from(documentationPublicationHistory).where(eq(documentationPublicationHistory.repository,location))).length,1);
 // A proposal retained against the old immutable snapshot cannot overwrite the new live state.
 const stale=reviewProposalFixture(baseline,false); await retainDocumentationProposal(stale);
 const staleView=await getPendingWorkspace({repository}); assert.equal(staleView.count,0);assert.equal(staleView.groups.length,0);assert.equal((await getDocumentationReview(stale.proposalId)).status,"found");
 assert.equal((await publishPendingWorkspace({repository,expectedHash:staleView.hash})).status,"blocked");
 const trackedBase=draftFixture();trackedBase.provenance.repository=location;trackedBase.context.find(choice=>choice.kind==="route")!.value="/stale";
 await saveDocumentationDraft(trackedBase);const trackedLive=await publishDocumentation({owner,repo:"product",route:"/stale",draftId:trackedBase.id});
 const tracked=reviewProposalFixture(trackedBase,false);await retainDocumentationProposal(tracked);const observed=await getPendingWorkspace({repository});
 const advanced=structuredClone(trackedBase);advanced.id=randomUUID();await saveDocumentationDraft(advanced);await publishDocumentation({owner,repo:"product",route:"/stale",draftId:advanced.id,observedId:trackedLive.publication!.id});
 assert.equal((await publishPendingWorkspace({repository,expectedHash:observed.hash})).status,"changed");
 const untouched=await getDocumentationReview(tracked.proposalId);if(untouched.status==="found")assert.equal(untouched.review,null,"stale publication changes never accept review choices");
 const approvedBase=draftFixture();approvedBase.provenance.repository=location;approvedBase.context.find(choice=>choice.kind==="route")!.value="/approved";
 await saveDocumentationDraft(approvedBase);await publishDocumentation({owner,repo:"product",route:"/approved",draftId:approvedBase.id});
 const alreadyApproved=reviewProposalFixture(approvedBase);const retainedApproved=await retainDocumentationProposal(alreadyApproved);
 const approvedOutcome=await applyDocumentationReview({proposalId:alreadyApproved.proposalId,expectedProposalHash:retainedApproved.proposalHash,decisions:alreadyApproved.results.map(result=>({decisionId:result.decisionId,choice:result.reviewReady?"approve":"acknowledge"})),publications:[]});
 assert.equal(approvedOutcome.status,"complete");
 const oldSelectionHash=approvedOutcome.review!.selectionHash;
 const approvedView=await getPendingWorkspace({repository});const approvedGroup=approvedView.groups.find(group=>group.changes.some(change=>change.proposalId===alreadyApproved.proposalId))!;
 const excludedApproved=approvedGroup.changes[1].key;const approvedSubset=await getPendingWorkspace({repository,excluded:[excludedApproved]});assert.equal(approvedSubset.blocked,false);
 assert.equal((await publishPendingWorkspace({repository,excluded:[excludedApproved],expectedHash:approvedSubset.hash})).status,"published");
 const approvedReceipt=await getDocumentationReview(alreadyApproved.proposalId);
 if(approvedReceipt.status==="found") {assert.equal(approvedReceipt.review!.selectionHash,oldSelectionHash,"historical approval is immutable");assert.deepEqual(approvedReceipt.review!.publications[0].decisionIds,["decision-1"]);assert.deepEqual(approvedReceipt.review!.publications[0].excludedDecisionIds,["decision-2"]);}
 // A wholly excluded previously approved proposal must also leave Pending Changes.
 const excludedBase=draftFixture();excludedBase.provenance.repository=location;excludedBase.context.find(choice=>choice.kind==="route")!.value="/excluded-unit";
 await saveDocumentationDraft(excludedBase);await publishDocumentation({owner,repo:"product",route:"/excluded-unit",draftId:excludedBase.id});
 const wholeExcluded=reviewProposalFixture(excludedBase,false);const retainedExcluded=await retainDocumentationProposal(wholeExcluded);
 const previousApproval=await applyDocumentationReview({proposalId:wholeExcluded.proposalId,expectedProposalHash:retainedExcluded.proposalHash,decisions:wholeExcluded.results.map(result=>({decisionId:result.decisionId,choice:result.reviewReady?"approve":"acknowledge"})),publications:[]});
 const includeBase=draftFixture();includeBase.provenance.repository=location;includeBase.context.find(choice=>choice.kind==="route")!.value="/included-unit";
 await saveDocumentationDraft(includeBase);await publishDocumentation({owner,repo:"product",route:"/included-unit",draftId:includeBase.id});
 const newIncluded=reviewProposalFixture(includeBase,false);await retainDocumentationProposal(newIncluded);
 const beforeExclusion=await getPendingWorkspace({repository});
 const allExcluded=beforeExclusion.groups.flatMap(group=>group.changes).filter(change=>change.proposalId===wholeExcluded.proposalId).map(change=>change.key);
 assert.ok(allExcluded.length);
 const batch=await getPendingWorkspace({repository,excluded:allExcluded});
 assert.equal((await publishPendingWorkspace({repository,excluded:allExcluded,expectedHash:batch.hash})).status,"published");
 const refreshed=await getPendingWorkspace({repository});
 assert.ok(!refreshed.groups.some(group=>group.changes.some(change=>change.proposalId===wholeExcluded.proposalId)),"excluded approvals never reappear on refresh");
 const excludedReceipt=await getDocumentationReview(wholeExcluded.proposalId);
 if(excludedReceipt.status==="found") {
   assert.equal(excludedReceipt.review!.selectionHash,previousApproval.review!.selectionHash,"previous approval remains immutable");
   assert.deepEqual(excludedReceipt.review!.exclusions?.map(item=>item.decisionId),["decision-1"]);
 }
 assert.equal((await getPublication({owner,repo:"product",route:"/excluded-unit"}))!.draftId,excludedBase.id,"excluded destination remains unchanged");
 const future=reviewProposalFixture(includeBase,false);await retainDocumentationProposal(future);
 const futureReview=await getDocumentationReview(future.proposalId);if(futureReview.status==="found")assert.equal(futureReview.review,null,"future proposals retain independent review authority");
 assert.ok(!(await getPendingWorkspace({repository})).groups.some(group=>group.changes.some(change=>change.proposalId===future.proposalId)),"retained future work with a stale baseline is audit-only");
 const expired=reviewProposalFixture(baseline,false); await retainDocumentationProposal(expired,{lifetimeMs:1});await new Promise(resolve=>setTimeout(resolve,5));
 const expiredView=await getPendingWorkspace({repository});assert.ok(!expiredView.groups.flatMap(group=>group.changes).some(change=>change.proposalId===expired.proposalId));assert.equal((await getDocumentationReview(expired.proposalId)).status,"found");
});
