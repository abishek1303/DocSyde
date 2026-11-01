import "server-only";
import { z } from "zod";
import { repositoryCoordinates, repositoryLocation } from "@/integrations/github/repository-identity";
import { assertAllowedRepository } from "@/features/sources/repository-access";
import { findLibraryArchive, selectLatestLibraryDraft, selectLibraryArchive, selectLibraryReviews } from "@/integrations/database/documentation-library";
import { validateDocumentationDocument } from "./document-validation";
import { readRetainedReview } from "./review-proposal-operations";

const inputSchema = repositoryCoordinates.extend({ page: z.coerce.number().int().min(1).max(10000).default(1) });
function scope(raw: unknown) {
  const input = inputSchema.parse(raw);
  assertAllowedRepository(input.owner, input.repo);
  return { ...input, repository: repositoryLocation(input) };
}
function readDocument(row: { id: string; document: unknown }, repository: string) {
  const document = validateDocumentationDocument(row.document);
  if (document.id !== row.id || document.provenance.repository.toLowerCase() !== repository) throw new Error("Document identity mismatch.");
  return document;
}
export async function latestDocumentationDraft(raw: unknown) {
  const { repository } = scope(raw);
  const row = await selectLatestLibraryDraft(repository);
  return row ? { document: readDocument(row, repository), savedAt: row.savedAt.toISOString() } : null;
}
export async function archivedDocumentationDraft(raw: unknown, rawVersion: unknown) {
  const id = z.uuid().parse(rawVersion), { repository } = scope(raw);
  const row = await findLibraryArchive(repository, id);
  return row ? { document: readDocument(row.draft, repository), route: row.publication.route, publishedAt: row.publication.publishedAt.toISOString(), archivedAt: row.publication.archivedAt.toISOString() } : null;
}
export async function documentationLibrary(raw: unknown, tab: "pending" | "archive") {
  const { repository, page } = scope(raw), offset = (page - 1) * 20;
  if (tab === "archive") {
    const rows = await selectLibraryArchive(repository, offset);
    return { archive: rows.slice(0, 20).map(row => ({ id: row.publication.id, documentId: row.draft.id, title: readDocument(row.draft, repository).title, route: row.publication.route, date: row.publication.publishedAt.toISOString(), archivedAt: row.publication.archivedAt.toISOString() })), proposals: [], hasMore: rows.length > 20 };
  }
  const rows = await selectLibraryReviews(repository, offset);
  return {
    archive: [], proposals: rows.slice(0, 20).map(row => {
      const state = readRetainedReview(row);
      if (state.review || Date.now() >= row.expiresAt.getTime() || !state.proposal.results.some(result => result.reviewReady && ["add", "revise"].includes(result.decision.action))) throw new Error("Pending review state mismatch.");
      return { id: row.id, title: state.proposal.impact.summary, date: row.registeredAt.toISOString() };
    }), hasMore: rows.length > 20
  };
}
