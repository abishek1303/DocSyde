import "server-only";
import { z } from "zod";
import { repositoryCoordinates, repositoryLocation } from "@/integrations/github/repository-identity";
import { assertAllowedRepository } from "@/features/sources/repository-access";
import { deletePublication, findPublication, findPublishedDocument, insertPublication, replacePublication } from "@/integrations/database/documentation-publications";
import type { DeliveryResponse } from "@/sdk/documentation-client";
import { getDocumentationDraft } from "./operations";
import { validateDocumentationDocument } from "./document-validation";
import { hostPathname, publicationRoute } from "./publication-target";

const target = repositoryCoordinates.extend({ route: publicationRoute }).strict();
const publishInput = target.extend({ draftId: z.uuid(), observedId: z.uuid().optional() }).strict();
function allowedRepository(raw: unknown) {
  const coordinates = repositoryCoordinates.parse(raw);
  assertAllowedRepository(coordinates.owner, coordinates.repo);
  return repositoryLocation(coordinates);
}
export function savedDocumentCoordinates(location: string) {
  const url = new URL(location);
  const parts = url.pathname.split("/");
  if (url.origin !== "https://github.com" || parts.length !== 3 || url.search || url.hash) throw new Error("Invalid document repository.");
  return repositoryCoordinates.parse({ owner: parts[1], repo: parts[2] });
}

export async function publishDocumentation(raw: unknown) {
  const input = publishInput.parse(raw);
  const repository = allowedRepository(input);
  const saved = await getDocumentationDraft(input.draftId);
  if (saved.status !== "found") throw new Error("Only valid persisted documents can be published.");
  if (repositoryLocation(savedDocumentCoordinates(saved.document.provenance.repository)) !== repository) throw new Error("Document repository mismatch.");
  if (input.observedId) {
    const current = await findPublication(repository, input.route);
    if (current?.id === input.observedId && current.draftId === input.draftId) return { status: "published" as const, publication: current };
  }
  const publication = input.observedId
    ? await replacePublication(repository, input.route, input.draftId, input.observedId)
    : await insertPublication(repository, input.route, input.draftId);
  return publication && publication.draftId === input.draftId
    ? { status: "published" as const, publication }
    : { status: "conflict" as const };
}

export async function unpublishDocumentation(raw: unknown) {
  const input = target.extend({ observedId: z.uuid() }).parse(raw);
  const removed = await deletePublication(allowedRepository(input), input.route, input.observedId);
  return { status: removed ? "unpublished" as const : "conflict" as const };
}

export async function getPublication(raw: unknown) {
  const input = target.parse(raw);
  return findPublication(allowedRepository(input), input.route);
}

export async function getContextualDocumentation(raw: unknown): Promise<DeliveryResponse> {
  const input = repositoryCoordinates.extend({ route: z.unknown() }).strict().parse(raw);
  const repository = allowedRepository(input);
  const row = await findPublishedDocument(repository, hostPathname(input.route));
  if (!row) return { version: 1, publication: null };
  const document = validateDocumentationDocument(row.draft.document);
  if (document.id !== row.draft.id || repositoryLocation(savedDocumentCoordinates(document.provenance.repository)) !== repository) throw new Error("Published document failed integrity checks.");
  return { version: 1, publication: {
    id: row.publication.id, documentId: document.id, publishedAt: row.publication.publishedAt.toISOString(),
    title: document.title,
    sections: document.sections.map(section => ({
      id: section.id, title: section.title,
      blocks: section.content.map(block => ({ markdown: block.markdown })),
      qualifications: section.qualifications.map(q => ({ support: q.support, confidence: q.confidence, confidenceReason: q.confidenceReason, assumptions: q.assumptions, uncertainties: q.uncertainties })),
    })),
    limitations: document.provenance.limitations,
  } };
}
