import "server-only";
import { and, desc, eq, lt, or, sql, inArray } from "drizzle-orm";
import { getDatabase } from "./client";
import { documentationRuns } from "./schema";
export async function insertDocumentationRun(id: string, repository: string, payload: unknown) {
  await getDatabase().insert(documentationRuns).values({ id, repository, status: "pending", payload });
}
export async function findDocumentationRun(id: string) {
  const [row] = await getDatabase().select().from(documentationRuns).where(eq(documentationRuns.id, id)).limit(1);
  return row ?? null;
}
export async function claimDocumentationRun(id: string, payload: unknown) {
  const rows = await getDatabase().update(documentationRuns).set({ status: "running", payload, updatedAt: new Date() }).where(and(eq(documentationRuns.id, id), eq(documentationRuns.status, "pending"))).returning({ id: documentationRuns.id });
  return rows.length === 1;
}
export async function updateDocumentationRun(id: string, status: string, payload: unknown) {
  const rows = await getDatabase().update(documentationRuns).set({ status, payload, updatedAt: new Date() }).where(and(eq(documentationRuns.id, id), eq(documentationRuns.status, "running"))).returning({ id: documentationRuns.id });
  if (!rows.length) throw new Error("Run is no longer running.");
}
export async function selectDocumentationRuns(repository: string, limit: number, before?: { createdAt: Date; id: string }) {
  return getDatabase().select().from(documentationRuns).where(and(eq(documentationRuns.repository, repository), before ? or(lt(documentationRuns.createdAt, before.createdAt), and(eq(documentationRuns.createdAt, before.createdAt), lt(documentationRuns.id, before.id))) : undefined)).orderBy(desc(documentationRuns.createdAt), desc(documentationRuns.id)).limit(limit);
}

export async function selectLatestDocumentationRuns(repository: string, heads: string[]) {
  if (!heads.length) return [];
  const head = sql<string>`${documentationRuns.payload}->'input'->>'head'`;
  return getDatabase().selectDistinctOn([head]).from(documentationRuns)
    .where(and(eq(documentationRuns.repository, repository), inArray(head, heads)))
    .orderBy(head, desc(documentationRuns.createdAt), desc(documentationRuns.id));
}
