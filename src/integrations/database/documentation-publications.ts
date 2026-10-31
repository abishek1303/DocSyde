import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDatabase, type DatabaseExecutor } from "./client";
import { documentationDrafts, documentationPublications as publications } from "./schema";

export async function findPublication(repository: string, route: string, database: DatabaseExecutor = getDatabase()) {
  const [row] = await database.select().from(publications)
    .where(and(eq(publications.repository, repository), eq(publications.route, route))).limit(1);
  return row ?? null;
}

export async function insertPublicationIfAbsent(repository: string, route: string, draftId: string, database: DatabaseExecutor = getDatabase()) {
  const [row] = await database.insert(publications).values({ id: randomUUID(), repository, route, draftId })
    .onConflictDoNothing({ target: [publications.repository, publications.route] }).returning();
  return row ?? null;
}

export async function insertPublication(repository: string, route: string, draftId: string, database: DatabaseExecutor = getDatabase()) {
  const row = await insertPublicationIfAbsent(repository, route, draftId, database);
  // A concurrent unpublish may remove the conflicting row: return a conflict,
  // never retry a mutation against state the operator did not observe.
  return row ?? await findPublication(repository, route, database);
}

export async function replacePublication(repository: string, route: string, draftId: string, observedId: string, database: DatabaseExecutor = getDatabase(), expectedDraftId?: string) {
  const [row] = await database.update(publications).set({ id: randomUUID(), draftId, publishedAt: new Date() })
    .where(and(eq(publications.repository, repository), eq(publications.route, route), eq(publications.id, observedId), expectedDraftId ? eq(publications.draftId, expectedDraftId) : undefined)).returning();
  return row ?? null;
}

export async function deletePublication(repository: string, route: string, observedId: string) {
  const rows = await getDatabase().delete(publications)
    .where(and(eq(publications.repository, repository), eq(publications.route, route), eq(publications.id, observedId))).returning({ id: publications.id });
  return rows.length === 1;
}

export async function findPublishedDocument(repository: string, route: string) {
  const [row] = await getDatabase().select({ publication: publications, draft: documentationDrafts }).from(publications)
    .innerJoin(documentationDrafts, eq(publications.draftId, documentationDrafts.id))
    .where(and(eq(publications.repository, repository), eq(publications.route, route))).limit(1);
  return row ?? null;
}

export async function publicationsForDrafts(repository: string, ids: string[]) {
  if (!ids.length) return [];
  return getDatabase().select().from(publications).where(and(eq(publications.repository, repository), inArray(publications.draftId, ids))).limit(65);
}
