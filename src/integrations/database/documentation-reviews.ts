import "server-only";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "./client";
import { documentationReviews, documentationDrafts } from "./schema";
import { insertDocumentationDraft } from "./documentation-drafts";
import { findPublication, insertPublicationIfAbsent, replacePublication } from "./documentation-publications";

export type RetainedReviewRow = typeof documentationReviews.$inferSelect;
export async function insertDocumentationReview(value: typeof documentationReviews.$inferInsert) {
  const [inserted] = await getDatabase().insert(documentationReviews).values(value).onConflictDoNothing().returning();
  return inserted ?? findDocumentationReview(value.id);
}
export async function findDocumentationReview(id: string) {
  const [row] = await getDatabase().select().from(documentationReviews).where(eq(documentationReviews.id, id));
  return row ?? null;
}

/** SQL stays here; the feature receives only review-specific operations. Every
 * mutation and its receipt run on this same connection under the review lock. */
export async function documentationReviewTransaction<T>(id: string, work: (scope: ReviewTransaction) => Promise<T>) {
  return getDatabase().transaction(async tx => {
    const [row] = await tx.select().from(documentationReviews).where(eq(documentationReviews.id, id)).for("update");
    return work({
      row: row ?? null,
      async baseline(documentId) {
        const [baseline] = await tx.select().from(documentationDrafts).where(eq(documentationDrafts.id, documentId)).for("share");
        return baseline ?? null;
      },
      save: (documentId, document) => insertDocumentationDraft(documentId, document, tx),
      publication: (repository, route) => findPublication(repository, route, tx),
      insertPublication: (repository, route, documentId) => insertPublicationIfAbsent(repository, route, documentId, tx),
      replacePublication: (repository, route, documentId, observedId, baselineId) => replacePublication(repository, route, documentId, observedId, tx, baselineId),
      async receipt(review) {
        await tx.update(documentationReviews).set({ review }).where(and(eq(documentationReviews.id, id), eq(documentationReviews.proposalHash, row.proposalHash)));
      },
    });
  });
}
export type ReviewTransaction = {
  row: RetainedReviewRow | null;
  baseline(id: string): Promise<typeof documentationDrafts.$inferSelect | null>;
  save(id: string, document: unknown): ReturnType<typeof insertDocumentationDraft>;
  publication(repository: string, route: string): ReturnType<typeof findPublication>;
  insertPublication(repository: string, route: string, documentId: string): ReturnType<typeof insertPublicationIfAbsent>;
  replacePublication(repository: string, route: string, documentId: string, observedId: string, baselineId: string): ReturnType<typeof replacePublication>;
  receipt(review: unknown): Promise<void>;
};
