import "server-only";
import { z } from "zod";
import { repositoryCoordinates, repositoryLocation } from "@/integrations/github/repository-identity";
import { assertAllowedRepository } from "@/features/sources/repository-access";
import { selectLiveLibrary, selectSavedLibraryVersions, selectHubReviews, findLibraryArchive, selectLatestLibraryDraft, selectLibraryArchive, selectLibraryReviews } from "@/integrations/database/documentation-library";
import { validateDocumentationDocument } from "../documents/document-validation";
import { readRetainedReview } from "../review/review-proposal-operations";

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

export async function documentationHub(raw: unknown, tab: "live" | "pending" | "history") {
  const { repository, page } = scope(raw), offset = (page - 1) * 20;
  if (tab === "live") {
    const rows = await selectLiveLibrary(repository, offset);
    return { kind: "live" as const, entries: rows.slice(0, 20).map(row => ({ document: readDocument(row.draft, repository), publishedAt: row.publication.publishedAt.toISOString(), route: row.publication.route, publicationId: row.publication.id })), hasMore: rows.length > 20 };
  }
  if (tab === "history") {
    const rows = await selectSavedLibraryVersions(repository, offset);
    return { kind: "history" as const, entries: rows.slice(0, 20).map(row => ({ document: readDocument(row, repository), savedAt: row.savedAt.toISOString() })), hasMore: rows.length > 20 };
  }
  const [rows, saves] = await Promise.all([selectHubReviews(repository, offset), selectSavedLibraryVersions(repository, offset, true)]);
  return { kind: "pending" as const, entries: rows.slice(0, 20).map(({ row, runId, runTitle }) => {
    const state = readRetainedReview(row);
    return { id: row.id, summary: state.proposal.impact.summary, date: row.registeredAt.toISOString(), runId, runTitle,
      status: state.review ? "Saving needs attention" : "Ready for review",
      targets: state.proposal.results.filter(result => result.reviewReady).map(result => {
        const target = state.proposal.targets.find(target => target.document.id === result.decision.documentId)?.document;
        const section = target?.sections.find(section => section.id === result.decision.sectionId);
        return { document: target?.title ?? "New document", section: section?.title, intent: result.decision.updateIntent ?? result.decision.reason };
      }) };
  }), saves: saves.slice(0, 20).map(row => ({ document: readDocument(row, repository), savedAt: row.savedAt.toISOString() })), hasMore: rows.length > 20 || saves.length > 20 };
}

export function documentSourceHead(document: import("../documents/document").DocumentationDocument) {
  return document.schemaVersion === 1 ? document.provenance.head : document.provenance.contexts.find(context => context.id === document.provenance.revision.contextId)?.head ?? null;
}
