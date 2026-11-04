import "server-only";
import { z } from "zod";
import { documentationReviewBatchTransaction } from "@/integrations/database/documentation-reviews";
import { selectedRepository } from "@/features/sources/run-preparation";
import { getDocumentationReview, readRetainedReview } from "./review-proposal-operations";
import { intrinsicReviewReady } from "./materialize-approved-changes";
import { hasOtherPendingProposal } from "./pending-workspace";
import { assertReliabilitySideEffect } from "@/integrations/reliability/execution-context";

export async function destinationChoices(proposalId: string) {
  const state = await getDocumentationReview(proposalId);
  if (state.status !== "found" || state.review || Date.now() >= Date.parse(state.expiresAt)) return [];
  return state.proposal.results.filter(result => intrinsicReviewReady(state.proposal, result)).map(result => {
    const unitId = result.decision.documentId ?? result.decisionId;
    return { unitId, title: result.change && "title" in result.change ? result.change.title : "Documentation update", proposalHash: state.proposalHash,
      options: state.destinationCandidates.filter(target => target.unitId === unitId).map(target => {
        const choice = state.proposal.authorizations.flatMap(auth => auth.associations).find(choice => target.associationIds.includes(choice.id));
        return { id: target.id, label: choice?.routeEvidence?.label ?? "Product screen", route: target.route, evidence: choice?.routeEvidence, confirmed: !!target.confirmedAt, automatic: target.requiresConfirmation === false };
      }) };
  }).filter(unit => unit.options.length);
}
export async function confirmDocumentationDestination(raw: unknown) {
  assertReliabilitySideEffect("product-mutation");
  const input = z.object({ repository: z.string(), proposalId: z.uuid(), expectedHash: z.string().regex(/^[a-f0-9]{64}$/), targetId: z.uuid(), confirmed: z.literal(true) }).strict().parse(raw);
  const repository = selectedRepository({ repository: input.repository });
  await documentationReviewBatchTransaction([input.proposalId], async ([scope], database) => {
    if (!scope.row || scope.row.repository !== repository.location.toLowerCase()) throw new Error("Proposal unavailable.");
    const state = readRetainedReview(scope.row);
    if (state.review || Date.now() >= Date.parse(state.expiresAt) || state.proposalHash !== input.expectedHash) throw new Error("Proposal changed or expired.");
    const target = state.destinationCandidates.find(target => target.id === input.targetId);
    if (!target || !state.proposal.results.some(result => (result.decision.documentId ?? result.decisionId) === target.unitId && intrinsicReviewReady(state.proposal, result))) throw new Error("Unsupported destination.");
    if (state.destinationCandidates.some(candidate => candidate.unitId === target.unitId && candidate.confirmedAt && candidate.id !== target.id)) throw new Error("Destination already confirmed.");
    const live = await scope.publication(repository.location.toLowerCase(), target.route);
    if ((live?.id ?? null) !== target.observedId || (target.observedId && live?.draftId !== target.baselineId)) throw new Error("Publication destination changed.");
    if (await hasOtherPendingProposal(repository.name, input.proposalId, database)) throw new Error("Resolve the other pending batch first.");
    if (!target.confirmedAt) await scope.confirmDestination(target.id, new Date().toISOString());
  }, repository.location.toLowerCase());
}
