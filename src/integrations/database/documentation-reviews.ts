import "server-only";
import { lockDocumentationProject } from "./documentation-review-lock";
import { and, eq, sql } from "drizzle-orm";
import { getDatabase, type DatabaseExecutor } from "./client";
import { documentationReviews, documentationDrafts, documentationRuns } from "./schema";
import { insertDocumentationDraft } from "./documentation-drafts";
import { findPublication, insertPublicationIfAbsent, replacePublication } from "./documentation-publications";

export type RetainedReviewRow = typeof documentationReviews.$inferSelect;
export async function insertDocumentationReview(value: typeof documentationReviews.$inferInsert) {
  return getDatabase().transaction(async tx => {
    await lockDocumentationProject(tx, value.repository);
    const [inserted] = await tx.insert(documentationReviews).values(value).onConflictDoNothing().returning();
    if (inserted) return inserted;
    const [existing] = await tx.select().from(documentationReviews).where(eq(documentationReviews.id, value.id));
    return existing ?? null;
  });
}
export async function findDocumentationReview(id: string, database: DatabaseExecutor = getDatabase()) {
  const [row] = await database.select().from(documentationReviews).where(eq(documentationReviews.id, id));
  return row ?? null;
}

/** SQL stays here; the feature receives only review-specific operations. Every
 * mutation and its receipt run on this same connection under the review lock. */
export async function documentationReviewTransaction<T>(id: string, work: (scope: ReviewTransaction) => Promise<T>) {
  return getDatabase().transaction(async tx => {
    const [row] = await tx.select().from(documentationReviews).where(eq(documentationReviews.id, id)).for("update");
    return work(reviewScope(row ?? null, tx));
  });
}
/** One atomic review/save/publication boundary for an explicitly selected repository batch. */
export async function documentationReviewBatchTransaction<T>(ids: string[], work: (scopes: ReviewTransaction[], database: DatabaseExecutor) => Promise<T>, repository?: string) {
  return getDatabase().transaction(async tx => {
    await tx.execute(sql`SET LOCAL statement_timeout = '15000ms'`);
    if (repository) await lockDocumentationProject(tx, repository);
    const scopes: ReviewTransaction[] = [];
    for (const id of [...ids].sort()) {
      const [row] = await tx.select().from(documentationReviews).where(eq(documentationReviews.id, id)).for("update");
      scopes.push(reviewScope(row ?? null, tx));
    }
    return work(scopes, tx);
  });
}
function reviewScope(row: RetainedReviewRow | null, tx: DatabaseExecutor): ReviewTransaction {
  return {
    row,
    async baseline(documentId) {
      const [baseline] = await tx.select().from(documentationDrafts).where(eq(documentationDrafts.id, documentId)).for("share");
      return baseline ?? null;
    },
    save: (documentId, document) => insertDocumentationDraft(documentId, document, tx),
    publication: (repository, route) => findPublication(repository, route, tx),
    insertPublication: (repository, route, documentId) => insertPublicationIfAbsent(repository, route, documentId, tx),
    replacePublication: (repository, route, documentId, observedId, baselineId) => replacePublication(repository, route, documentId, observedId, tx, baselineId),
    async confirmDestination(targetId, at) {
      if (!row) throw new Error("Retained review is missing.");
      const targets = row.targets as { id: string; confirmedAt?: string }[];
      await tx.update(documentationReviews).set({ targets: targets.map(target => target.id === targetId ? { ...target, confirmedAt: at } : target) }).where(and(eq(documentationReviews.id, row.id), eq(documentationReviews.proposalHash, row.proposalHash)));
    },
    async receipt(review) {
      if (!row) throw new Error("Retained review is missing.");
      await tx.update(documentationReviews).set({ review }).where(and(eq(documentationReviews.id, row.id), eq(documentationReviews.proposalHash, row.proposalHash)));
    },
  };
}
export type ReviewTransaction = {
  row: RetainedReviewRow | null;
  baseline(id: string): Promise<typeof documentationDrafts.$inferSelect | null>;
  save(id: string, document: unknown): ReturnType<typeof insertDocumentationDraft>;
  publication(repository: string, route: string): ReturnType<typeof findPublication>;
  insertPublication(repository: string, route: string, documentId: string): ReturnType<typeof insertPublicationIfAbsent>;
  replacePublication(repository: string, route: string, documentId: string, observedId: string, baselineId: string): ReturnType<typeof replacePublication>;
  receipt(review: unknown): Promise<void>;
  confirmDestination(targetId: string, at: string): Promise<void>;
};

export type RetentionRunLink = {
  id: string; token: string;
  complete(payload: unknown, row: RetainedReviewRow, database: DatabaseExecutor): unknown | Promise<unknown>;
};
/** Authority insertion and the run reference share one commit. No document/publication writes. */
export async function insertDocumentationReviewForRun(value: typeof documentationReviews.$inferInsert, link: RetentionRunLink) {
  return getDatabase().transaction(async tx => {
    await lockDocumentationProject(tx, value.repository);
    await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
    const [run] = await tx.select().from(documentationRuns).where(eq(documentationRuns.id, link.id)).for("update");
    if (!run || run.repository !== value.repository || run.status !== "running") throw new Error("Retention run unavailable.");
    const [inserted] = await tx.insert(documentationReviews).values(value).onConflictDoNothing().returning();
    const row = inserted ?? (await tx.select().from(documentationReviews).where(eq(documentationReviews.id, value.id)))[0];
    if (!row || row.repository !== value.repository || row.proposalHash !== value.proposalHash) throw new Error("Proposal identity conflict.");
    const payload = await link.complete(run.payload, row, tx);
    // SQL guard supplements feature validation and serializes against cancellation.
    const updated = await tx.update(documentationRuns).set({ status: "finished", payload, updatedAt: new Date() }).where(and(
      eq(documentationRuns.id, link.id), eq(documentationRuns.status, "running"),
      sql`${documentationRuns.payload}->'execution'->>'token' = ${link.token}`,
      sql`${documentationRuns.payload}->'execution'->>'cancelRequestedAt' IS NULL`,
    )).returning({ id: documentationRuns.id });
    if (!updated.length) throw new Error("Retention ownership lost or cancelled.");
    return row;
  });
}
