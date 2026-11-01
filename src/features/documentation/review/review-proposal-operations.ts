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
  return { proposal, targets, review, repository, proposalHash: row.proposalHash, registeredAt: row.registeredAt.toISOString(), expiresAt: row.expiresAt.toISOString() };
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
    const baseline = proposal.targets.find(t => t.document.id === unitId)?.document;
    const choices = [...(baseline?.context ?? []), ...proposal.authorizations.filter(a => results.some(r => r.decisionId === a.decisionId)).flatMap(a => a.associations)];
    const routes = new Map<string, string[]>();
    for (const choice of choices) if (choice.kind === "route" && publicationRoute.safeParse(choice.value).success) routes.set(choice.value, [...new Set([...(routes.get(choice.value) ?? []), choice.id])]);
    for (const [route, associationIds] of routes) {
      if (await findPublication(repository, route)) continue;
      targets.push({ id: documentationId(`${proposal.proposalId}:publish:${unitId}:${route}`), unitId, baselineId: baseline?.id ?? null, route, observedId: null, associationIds });
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
