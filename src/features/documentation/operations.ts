import "server-only";
import { z } from "zod";
import { findDocumentationDraft, insertDocumentationDraft, selectDocumentationDrafts } from "@/integrations/database/documentation-drafts";
import { validateDocumentationDocument } from "./document-validation";
import type { DocumentationDocument } from "./document";

type SavedDraft = { document: DocumentationDocument; savedAt: Date };
type Cursor = { savedAt: string; id: string };
type DraftEntry = { id: string; savedAt: Date } & (
  { status: "available"; title: string; repository: string; generatedAt: string } |
  { status: "unavailable" }
);
const cursorSchema = z.object({ savedAt: z.string().datetime(), id: z.uuid() }).strict();
const listInput = z.object({ limit: z.number().int().min(1).max(50).default(20), before: cursorSchema.optional() }).strict();

function readDocument(row: { id: string; document: unknown }): DocumentationDocument {
  const document = validateDocumentationDocument(row.document);
  if (document.id !== row.id) throw new Error("Stored document identity mismatch.");
  return document;
}

// Trusted local demo operations. Public deployment needs user/resource access
// control here; repository provenance is not a Project binding or authorization.
export async function saveDocumentationDraft(raw: unknown): Promise<({ status: "saved" } & SavedDraft) | { status: "conflict" }> {
  const document = validateDocumentationDocument(raw);
  const result = await insertDocumentationDraft(document.id, document);
  if (!result.equal) return { status: "conflict" };
  return { status: "saved", document: readDocument(result.row), savedAt: result.row.savedAt };
}

export async function getDocumentationDraft(rawId: unknown): Promise<({ status: "found" } & SavedDraft) | { status: "missing" } | { status: "invalid"; id: string; savedAt: Date }> {
  const row = await findDocumentationDraft(z.uuid().parse(rawId));
  if (!row) return { status: "missing" };
  try {
    return { status: "found", document: readDocument(row), savedAt: row.savedAt };
  } catch {
    return { status: "invalid", id: row.id, savedAt: row.savedAt };
  }
}

export async function listDocumentationDrafts(raw: unknown = {}): Promise<{ entries: DraftEntry[]; nextCursor: Cursor | null }> {
  const { limit, before } = listInput.parse(raw);
  const rows = await selectDocumentationDrafts(limit + 1, before && { ...before, savedAt: new Date(before.savedAt) });
  const page = rows.slice(0, limit);
  const entries: DraftEntry[] = page.map(row => {
    const metadata = { id: row.id, savedAt: row.savedAt };
    try {
      const document = readDocument(row);
      return { ...metadata, status: "available", title: document.title, repository: document.provenance.repository, generatedAt: document.generation.createdAt };
    } catch {
      return { ...metadata, status: "unavailable" };
    }
  });
  const last = page.at(-1);
  return { entries, nextCursor: rows.length > limit && last ? { id: last.id, savedAt: last.savedAt.toISOString() } : null };
}
