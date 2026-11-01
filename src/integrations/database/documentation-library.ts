import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDatabase } from "./client";
import { documentationDrafts as drafts, documentationPublicationHistory as history, documentationReviews as reviews } from "./schema";

export async function selectLatestLibraryDraft(repository: string) {
  const [row] = await getDatabase().select().from(drafts)
    .where(sql`lower(${drafts.document}->'provenance'->>'repository') = ${repository}`)
    .orderBy(desc(drafts.savedAt), desc(drafts.id)).limit(1);
  return row ?? null;
}
export async function selectLibraryArchive(repository: string, offset: number) {
  return getDatabase().select({ publication: history, draft: drafts }).from(history)
    .innerJoin(drafts, eq(history.draftId, drafts.id)).where(eq(history.repository, repository))
    .orderBy(desc(history.archivedAt), desc(history.id)).limit(21).offset(offset);
}
export async function findLibraryArchive(repository: string, id: string) {
  const [row] = await getDatabase().select({ publication: history, draft: drafts }).from(history)
    .innerJoin(drafts, eq(history.draftId, drafts.id)).where(and(eq(history.repository, repository), eq(history.id, id))).limit(1);
  return row ?? null;
}
export async function selectLibraryReviews(repository: string, offset: number) {
  return getDatabase().select().from(reviews).where(and(eq(reviews.repository, repository),
    sql`${reviews.review} IS NULL`, sql`${reviews.expiresAt} > now()`,
    sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${reviews.proposal}->'results') result
      WHERE result->>'reviewReady' = 'true' AND result->'decision'->>'action' IN ('add', 'revise'))`,
  )).orderBy(desc(reviews.registeredAt), desc(reviews.id)).limit(21).offset(offset);
}
