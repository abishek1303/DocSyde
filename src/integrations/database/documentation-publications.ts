import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "./client";
import { documentationDrafts, documentationPublications as publications } from "./schema";

export async function findPublication(repository: string, route: string) {
  const [row] = await getDatabase().select().from(publications)
    .where(and(eq(publications.repository, repository), eq(publications.route, route))).limit(1);
  return row ?? null;
}

export async function insertPublication(repository: string, route: string, draftId: string) {
  const [row] = await getDatabase().insert(publications).values({ id: randomUUID(), repository, route, draftId })
    .onConflictDoNothing({ target: [publications.repository, publications.route] }).returning();
  // A concurrent unpublish may remove the conflicting row: return a conflict,
  // never retry a mutation against state the operator did not observe.
  return row ?? await findPublication(repository, route);
}

export async function replacePublication(repository: string, route: string, draftId: string, observedId: string) {
  const [row] = await getDatabase().update(publications).set({ id: randomUUID(), draftId, publishedAt: new Date() })
    .where(and(eq(publications.repository, repository), eq(publications.route, route), eq(publications.id, observedId))).returning();
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
