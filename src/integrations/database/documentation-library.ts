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

/** The hub reads existing immutable saves and active publications; no new store. */
export async function selectLiveLibrary(repository: string, offset: number) {
  const { documentationPublications: live } = await import("./schema");
  return getDatabase().select({ publication: live, draft: drafts }).from(live)
    .innerJoin(drafts, eq(live.draftId, drafts.id)).where(eq(live.repository, repository))
    .orderBy(desc(live.publishedAt), desc(live.id)).limit(21).offset(offset);
}
export async function selectSavedLibraryVersions(repository: string, offset: number, unpublished = false) {
  const { documentationPublications: live } = await import("./schema");
  return getDatabase().select().from(drafts).where(and(
    sql`lower(${drafts.document}->'provenance'->>'repository') = ${repository}`,
    unpublished ? sql`NOT EXISTS (SELECT 1 FROM ${live} WHERE ${live.draftId} = ${drafts.id}) AND NOT EXISTS (SELECT 1 FROM ${history} WHERE ${history.draftId} = ${drafts.id})` : undefined,
  )).orderBy(desc(drafts.savedAt), desc(drafts.id)).limit(21).offset(offset);
}
export async function selectHubReviews(repository: string, offset: number) {
  const { documentationRuns: runs } = await import("./schema");
  return getDatabase().select({ row: reviews, runId: runs.id, runTitle: sql<string | null>`${runs.payload}->>'title'` }).from(reviews)
    .leftJoin(runs, and(eq(runs.repository, repository), sql`${runs.payload}->'retainedProposal'->>'proposalId' = ${reviews.id}::text`))
    .where(and(eq(reviews.repository, repository), sql`(
      (${reviews.review} IS NULL AND ${reviews.expiresAt} > now()) OR
      (${reviews.review} IS NOT NULL AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(${reviews.review}->'selection'->'decisions') choice
        WHERE choice->>'choice' = 'approve' AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(${reviews.review}->'saves') receipt
          WHERE receipt->>'status' = 'saved' AND receipt->'decisionIds' ? (choice->>'decisionId')
        )
      ))
    )`))
    .orderBy(desc(reviews.registeredAt), desc(reviews.id)).limit(21).offset(offset);
}
