import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { findRunForProposal } from "@/integrations/database/documentation-runs";
import { hasPublishedDocument } from "@/integrations/database/documentation-publications";
import { getArtifactStorage } from "@/integrations/storage/storage";
import { getDocumentableRunCaptures } from "../runs/retained-runtime-evidence";
import { getDocumentationReview } from "../review/review-proposal-operations";
import { intrinsicReviewReady } from "../review/materialize-approved-changes";
import { authoredSections } from "../transformation/transformation-validation";
import { documentationHash, documentationId } from "../documents/document-identity";
import { getDocumentationDraft } from "../documents/operations";
import type { DocumentationChangeProposal } from "../transformation/documentation-change-proposal";
import type { DocumentationDocument } from "../documents/document";
import { selectedRepository } from "@/features/sources/run-preparation";
import { documentImageSchema, type DocumentImage } from "./document-image";

export type ImageSuggestion = { decisionId: string; sectionIndex: number; sectionTitle: string; image: DocumentImage };
export async function proposalImageSuggestions(proposal: DocumentationChangeProposal): Promise<ImageSuggestion[]> {
  const repository = proposal.impact.provenance.source.repository.toLowerCase();
  const linked = await findRunForProposal(repository, proposal.proposalId);
  if (!linked) return [];
  const retained = await getDocumentableRunCaptures(linked.id);
  if (!retained || !("schemaVersion" in retained.run.record)) return [];
  const record = retained.run.record;
  if (record.retainedProposal?.proposalId !== proposal.proposalId || record.retainedProposal.proposalHash !== documentationHash(proposal)
    || documentationHash(record.impact) !== proposal.impactSha256 || `https://github.com/${record.input.owner}/${record.input.repo}`.toLowerCase() !== repository) throw new Error("Screenshot ownership mismatch.");
  const suggestions: ImageSuggestion[] = [];
  for (const result of proposal.results) {
    if (!intrinsicReviewReady(proposal, result) || !result.change) continue;
    const baseline = proposal.targets.find(target => target.document.id === result.decision.documentId)?.document;
    const auth = proposal.authorizations.find(auth => auth.decisionId === result.decisionId)!;
    for (const [sectionIndex, section] of authoredSections(result.change).entries()) {
      const claimIds = new Set(section.content.flatMap(block => block.claimRefs));
      const refs = new Set(proposal.plan.claimCatalog.filter(claim => claimIds.has(claim.id)).flatMap(claim => claim.claim.references));
      const captureIds = new Set(proposal.impact.provenance.visualReferences.filter(ref => refs.has(ref.id)).map(ref => ref.captureId));
      const context = [...(baseline?.context ?? []), ...auth.associations];
      const documentAssociations = result.change.kind === "add-document" || result.change.kind === "replace-document" ? result.change.associations : baseline?.associations ?? [];
      const associationIds = new Set([...documentAssociations, ...section.associations]);
      const routes = context.filter(choice => choice.kind === "route" && associationIds.has(choice.id)).map(choice => choice.value);
      const candidates = retained.captures.filter(capture => {
        const used = proposal.impact.provenance.captures.find(item => item.captureId === capture.evidence.captureId);
        return used && used.screenshotSha256 === capture.evidence.screenshotSha256 && (!used.artifactKey || used.artifactKey === capture.evidence.artifactKey)
          && (captureIds.has(capture.evidence.captureId) || capture.sourceRefs.some(ref => refs.has(ref)))
          && routes.some(route => route === capture.evidence.finalPathname || route === capture.evidence.requestedPathname);
      }).sort((a, b) => a.evidence.capturedAt.localeCompare(b.evidence.capturedAt));
      // One illustrative image per changed section, at most three across a proposal.
      const capture = candidates.at(-1);
      if (!capture || !capture.evidence.artifactKey || suggestions.length >= 3) continue;
      const image = documentImageSchema.parse({ id: documentationId(`${proposal.proposalId}:${result.decisionId}:${sectionIndex}:${capture.evidence.captureId}`),
        artifactKey: capture.evidence.artifactKey, sha256: capture.evidence.screenshotSha256, runId: retained.run.id, proposalId: proposal.proposalId,
        decisionId: result.decisionId, captureId: capture.evidence.captureId, pathname: capture.evidence.finalPathname, capturedAt: capture.evidence.capturedAt,
        width: capture.width, height: capture.height, alt: `Product screen illustrating ${section.title}`.slice(0, 240),
        caption: "Captured product screen. This illustrates the visible state, not automatic behavior." });
      suggestions.push({ decisionId: result.decisionId, sectionIndex, sectionTitle: section.title, image });
    }
  }
  return suggestions;
}
async function readDocumentImageBytes(image: DocumentImage) {
  const bytes = await getArtifactStorage().read(image.artifactKey);
  if (!bytes || bytes.length > 10 * 1024 * 1024 || bytes.length < 24 || createHash("sha256").update(bytes).digest("hex") !== image.sha256
    || Buffer.from(bytes).subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
    || Buffer.from(bytes).readUInt32BE(16) !== image.width || Buffer.from(bytes).readUInt32BE(20) !== image.height) throw new Error("Screenshot integrity failure.");
  return bytes;
}
/** Publication gate: reference metadata alone never authorizes a private artifact. */
export async function assertDocumentImages(document: DocumentationDocument) {
  const proposals = new Map<string, ImageSuggestion[]>();
  for (const section of document.sections) for (const image of section.images ?? []) {
    let suggestions = proposals.get(image.proposalId);
    if (!suggestions) {
      const review = await getDocumentationReview(image.proposalId);
      if (review.status !== "found" || review.repository !== document.provenance.repository.toLowerCase()) throw new Error("Screenshot repository mismatch.");
      suggestions = await proposalImageSuggestions(review.proposal); proposals.set(image.proposalId, suggestions);
    }
    const match = suggestions.find(suggestion => documentationHash(suggestion.image) === documentationHash(image));
    if (!match) throw new Error("Screenshot is not owned by the relevant inspection.");
    const review = await getDocumentationReview(image.proposalId);
    const result = review.status === "found" ? review.proposal.results.find(result => result.decisionId === image.decisionId) : null;
    const authored = result?.change ? authoredSections(result.change)[match.sectionIndex] : null;
    const copy = (entry: { title: string; kind: string; content: { markdown: string }[] }) => ({ title: entry.title, kind: entry.kind, content: entry.content.map(block => block.markdown) });
    if (!authored || documentationHash(copy(authored)) !== documentationHash(copy(section))) throw new Error("Screenshot section correspondence failure.");
    await readDocumentImageBytes(image);
  }
}
export async function publishedDocumentImage(rawRepository: unknown, rawDocumentId: unknown, rawImageId: unknown) {
  const repository = selectedRepository({ repository: z.string().parse(rawRepository) }), documentId = z.uuid().parse(rawDocumentId), imageId = z.uuid().parse(rawImageId);
  if (!await hasPublishedDocument(repository.location, documentId)) return null;
  const saved = await getDocumentationDraft(documentId, repository.location);
  if (saved.status !== "found") return null;
  const image = saved.document.sections.flatMap(section => section.images ?? []).find(image => image.id === imageId);
  return image ? readDocumentImageBytes(image) : null;
}
export async function pendingDocumentImage(rawProposalId: unknown, rawImageId: unknown) {
  const proposalId = z.uuid().parse(rawProposalId), imageId = z.uuid().parse(rawImageId);
  const review = await getDocumentationReview(proposalId);
  if (review.status !== "found" || (!review.review && Date.now() >= Date.parse(review.expiresAt))) return null;
  const suggestion = (await proposalImageSuggestions(review.proposal)).find(suggestion => suggestion.image.id === imageId);
  return suggestion ? readDocumentImageBytes(suggestion.image) : null;
}
