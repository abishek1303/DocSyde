import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDatabase, type DatabaseExecutor } from "./client";
import { documentationDrafts, documentationPublications as publications, documentationPublicationHistory as history } from "./schema";

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
  return database.transaction(async tx => {
    const condition = and(eq(publications.repository, repository), eq(publications.route, route), eq(publications.id, observedId), expectedDraftId ? eq(publications.draftId, expectedDraftId) : undefined);
    const [current] = await tx.select().from(publications).where(condition).limit(1).for("update");
    if (!current) return null;
    // The same snapshot is already active; preserve its publication identity and
    // avoid manufacturing an archived version on an idempotent request.
    if (current.draftId === draftId) return current;
    const [next] = await tx.update(publications).set({ id: randomUUID(), draftId, publishedAt: new Date() }).where(condition).returning();
    if (!next) return null;
    await tx.insert(history).values(current);
    return next;
  });
}

export async function deletePublication(repository: string, route: string, observedId: string) {
  return getDatabase().transaction(async tx => {
    const condition = and(eq(publications.repository, repository), eq(publications.route, route), eq(publications.id, observedId));
    const [current] = await tx.select().from(publications).where(condition).limit(1).for("update");
    if (!current) return false;
    const removed = await tx.delete(publications).where(condition).returning({ id: publications.id });
    if (!removed.length) return false;
    await tx.insert(history).values(current);
    return true;
  });
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
