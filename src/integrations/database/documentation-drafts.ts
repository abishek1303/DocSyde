import "server-only";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { getDatabase } from "./client";
import { documentationDrafts } from "./schema";

export async function insertDocumentationDraft(id: string, document: unknown) {
  const database = getDatabase();
  const [inserted] = await database.insert(documentationDrafts).values({ id, document })
    .onConflictDoNothing({ target: documentationDrafts.id }).returning();
  if (inserted) return { row: inserted, equal: true };
  // JSONB equality deliberately ignores object key order. Never UPDATE a draft.
  const [existing] = await database.select({
    id: documentationDrafts.id,
    document: documentationDrafts.document,
    savedAt: documentationDrafts.savedAt,
    equal: sql<boolean>`${documentationDrafts.document} = ${JSON.stringify(document)}::jsonb`,
  }).from(documentationDrafts).where(eq(documentationDrafts.id, id)).limit(1);
  if (!existing) throw new Error("Draft insert returned no record.");
  return { row: existing, equal: existing.equal };
}

export async function findDocumentationDraft(id: string, repository?: string) {
  const [row] = await getDatabase().select().from(documentationDrafts)
    .where(and(eq(documentationDrafts.id, id), repository ? sql`lower(${documentationDrafts.document}->'provenance'->>'repository') = ${repository.toLowerCase()}` : undefined)).limit(1);
  return row ?? null;
}

export async function selectDocumentationDrafts(limit: number, before?: { savedAt: Date; id: string }, repository?: string) {
  return getDatabase().select().from(documentationDrafts).where(and(repository ? sql`lower(${documentationDrafts.document}->'provenance'->>'repository') = ${repository.toLowerCase()}` : undefined, before ? or(
    lt(documentationDrafts.savedAt, before.savedAt),
    and(eq(documentationDrafts.savedAt, before.savedAt), lt(documentationDrafts.id, before.id)),
  ) : undefined)).orderBy(desc(documentationDrafts.savedAt), desc(documentationDrafts.id)).limit(limit);
}
