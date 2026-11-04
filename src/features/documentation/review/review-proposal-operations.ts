import "server-only";
import { z } from "zod";
import { repositoryCoordinates, repositoryLocation } from "@/integrations/github/repository-identity";
import { assertAllowedRepository } from "@/features/sources/repository-access";
import { publicationsForDrafts, findPublication } from "@/integrations/database/documentation-publications";
import { findDocumentationReview, insertDocumentationReview, insertDocumentationReviewForRun, type RetentionRunLink, type RetainedReviewRow } from "@/integrations/database/documentation-reviews";
import type { DocumentationChangeProposal } from "../transformation/documentation-change-proposal";
import { validateDocumentationProposal } from "../transformation/validate-documentation-proposal";
import { documentationHash, documentationId } from "../documents/document-identity";
import { acceptedReviewSchema, publicationDescriptorSchema, REVIEW_INITIAL_LIFETIME_MS, REVIEW_MAX_PUBLICATION_TARGETS, type PublicationDescriptor } from "./documentation-review";
import { intrinsicReviewReady } from "./materialize-approved-changes";
import { publicationRoute } from "../publication/publication-target";

export function reviewRepository(location: string) {
  const url = new URL(location), parts = url.pathname.split("/");
  if (url.origin !== "https://github.com" || parts.length !== 3 || url.search || url.hash) throw new Error("Invalid review repository.");
  const coordinates = repositoryCoordinates.parse({ owner: parts[1], repo: parts[2] });
  assertAllowedRepository(coordinates.owner, coordinates.repo);
  return repositoryLocation(coordinates);
}
export function readRetainedReview(row: RetainedReviewRow) {
  const repository = reviewRepository(row.repository);
  const proposal = validateDocumentationProposal(row.proposal);
  if (row.id !== proposal.proposalId || documentationHash(proposal) !== row.proposalHash || reviewRepository(proposal.impact.provenance.source.repository) !== repository) throw new Error("Retained proposal integrity failure.");
  const targets = z.array(publicationDescriptorSchema).max(REVIEW_MAX_PUBLICATION_TARGETS).parse(row.targets);
  if (new Set(targets.map(t => t.id)).size !== targets.length) throw new Error("Duplicate publication descriptor.");
  const review = row.review === null ? null : acceptedReviewSchema.parse(row.review);
  if (review && (review.selection.proposalId !== row.id || review.selection.expectedProposalHash !== row.proposalHash || documentationHash(review.selection) !== review.selectionHash)) throw new Error("Retained selection integrity failure.");
  if (review?.exclusions && (new Set(review.exclusions.map(item => item.decisionId)).size !== review.exclusions.length
    || review.exclusions.some(item => !proposal.results.some(result => result.decisionId === item.decisionId && ["add", "revise"].includes(result.decision.action))))) throw new Error("Exclusion receipt integrity failure.");
  for (const receipt of review?.publications ?? []) if (receipt.decisionIds || receipt.excludedDecisionIds) {
    const target = targets.find(target => target.id === receipt.targetId);
    const all = [...(receipt.decisionIds ?? []), ...(receipt.excludedDecisionIds ?? [])];
    if (!receipt.decisionIds || receipt.decisionIds.some(id => !review!.selection.decisions.some(choice => choice.decisionId === id && choice.choice === "approve")) || !target || new Set(all).size !== all.length || all.some(id => !proposal.results.some(result => result.decisionId === id && (result.decision.documentId ?? result.decisionId) === target.unitId))) throw new Error("Publication decision receipt integrity failure.");
  }
  const confirmedUnits = new Set(targets.filter(target => target.confirmedAt).map(target => target.unitId));
  const destinationCandidates = targets.filter(target => target.requiresConfirmation !== undefined);
  const activeTargets = targets.filter(target => confirmedUnits.has(target.unitId) ? !!target.confirmedAt : !target.requiresConfirmation);
  return { proposal, targets: activeTargets, destinationCandidates, review, repository, proposalHash: row.proposalHash, registeredAt: row.registeredAt.toISOString(), expiresAt: row.expiresAt.toISOString() };
}

/** Trusted producer entry ONLY: call directly with transformDocumentation output.
 * Not an HTTP action, unsigned artifact importer, or client authentication boundary. */
export async function retainDocumentationProposal(output: DocumentationChangeProposal, { lifetimeMs = REVIEW_INITIAL_LIFETIME_MS, runLink }: { lifetimeMs?: number; runLink?: RetentionRunLink } = {}) {
  const proposal = validateDocumentationProposal(output), repository = reviewRepository(proposal.impact.provenance.source.repository);
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > REVIEW_INITIAL_LIFETIME_MS) throw new Error("Invalid review lifetime.");
  const proposalHash = documentationHash(proposal), existing = await findDocumentationReview(proposal.proposalId);
  if (existing && !runLink) {
    if (existing.proposalHash !== proposalHash || existing.repository !== repository) throw new Error("Proposal identity conflict.");
    return { proposalId: existing.id, ...readRetainedReview(existing) };
  }
  const mutable = proposal.results.filter(r => r.decision.action === "revise" || r.decision.action === "add");
  const baselineIds = [...new Set(mutable.flatMap(r => r.decision.documentId ? [r.decision.documentId] : []))];
  const targets: PublicationDescriptor[] = [];
  const publications = await publicationsForDrafts(repository, baselineIds);
  if (publications.length > REVIEW_MAX_PUBLICATION_TARGETS) throw new Error("Publication context exceeds review bound.");
  for (const publication of publications) targets.push({ id: documentationId(`${proposal.proposalId}:replace:${publication.id}`),
    unitId: publication.draftId, baselineId: publication.draftId, route: publicationRoute.parse(publication.route), observedId: publication.id, associationIds: [] });
  const units = new Map<string, typeof mutable>();
  for (const r of mutable) { const key = r.decision.documentId ?? r.decisionId; units.set(key, [...(units.get(key) ?? []), r]); }
  for (const [unitId, results] of units) {
    if (proposal.plan.objective === "fresh" && !results.every(result => intrinsicReviewReady(proposal, result))) continue;
    const baseline = proposal.targets.find(t => t.document.id === unitId)?.document;
    // Existing published versions retain their observed destinations; old discovery hints cannot expand authority.
    const choices = [...(baseline?.context.filter(choice => choice.origin !== "discovery") ?? []), ...proposal.authorizations.filter(a => results.some(r => r.decisionId === a.decisionId)).flatMap(a => a.associations).filter(choice => !baseline || choice.origin !== "discovery")];
    const routes = new Map<string, string[]>();
    for (const choice of choices) if (choice.kind === "route" && publicationRoute.safeParse(choice.value).success) routes.set(choice.value, [...new Set([...(routes.get(choice.value) ?? []), choice.id])]);
    for (const [route, associationIds] of routes) {
      const live = await findPublication(repository, route);
      // Fresh candidates are already generated and support checked. Only now match
      // route/version identity, without reading or reusing old document content.
      if (live && proposal.plan.objective !== "fresh") continue;
      targets.push({ id: documentationId(`${proposal.proposalId}:publish:${unitId}:${route}`), unitId, baselineId: live?.draftId ?? baseline?.id ?? null, route, observedId: live?.id ?? null, associationIds, ...(choices.some(choice => choice.kind === "route" && choice.value === route && choice.origin === "discovery") ? { requiresConfirmation: choices.filter(choice => choice.kind === "route" && choice.value === route).every(choice => choice.origin === "discovery" && choice.routeEvidence?.requiresConfirmation) } : {}) });
      if (targets.length > REVIEW_MAX_PUBLICATION_TARGETS) throw new Error("Publication context exceeds review bound.");
    }
  }
  const registeredAt = new Date(), expiresAt = new Date(registeredAt.getTime() + lifetimeMs);
  const value = { id: proposal.proposalId, repository, proposalHash, proposal, targets, registeredAt, expiresAt };
  const row = runLink ? await insertDocumentationReviewForRun(value, runLink) : await insertDocumentationReview(value);
  if (!row || row.proposalHash !== proposalHash || row.repository !== repository) throw new Error("Proposal identity conflict.");
  return { proposalId: row.id, ...readRetainedReview(row) };
}
export async function getDocumentationReview(proposalId: string) {
  const row = await findDocumentationReview(z.uuid().parse(proposalId));
  return row ? { status: "found" as const, proposalId: row.id, ...readRetainedReview(row) } : { status: "missing" as const };
}

/** Read-only presentation state; expiry never changes retained authority. */
export async function getDocumentationReviewPresentation(proposalId: string) {
  const review = await getDocumentationReview(proposalId);
  return review.status === "found" ? { ...review, expired: !review.review && Date.now() >= Date.parse(review.expiresAt) } : review;
}
