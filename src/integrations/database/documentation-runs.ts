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

export type DocumentationRunRow = typeof documentationRuns.$inferSelect;
type RunMutation = { status: string; payload: unknown };
// Short row-locked mutations merge against the latest payload, never a task's stale copy.
export async function mutateDocumentationRun(id: string, change: (row: DocumentationRunRow) => RunMutation | null) {
  return getDatabase().transaction(async tx => {
    await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
    const [row] = await tx.select().from(documentationRuns).where(eq(documentationRuns.id, id)).for("update");
    if (!row) throw new Error("Run not found.");
    const next = change(row);
    if (next) await tx.update(documentationRuns).set({ ...next, updatedAt: new Date() }).where(eq(documentationRuns.id, id));
    return next ?? { status: row.status, payload: row.payload };
  });
}
export async function runningDocumentationRuns() {
  return getDatabase().select().from(documentationRuns).where(eq(documentationRuns.status, "running"));
}
export async function admitDocumentationRun(id: string, repository: string, claim: (row: DocumentationRunRow) => RunMutation | null) {
  return getDatabase().transaction(async tx => {
    await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
    // Serializes admission only; it is never held while models/browser work runs.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(178523, 1)`);
    const [row] = await tx.select().from(documentationRuns).where(eq(documentationRuns.id, id)).for("update");
    if (!row || row.repository !== repository) throw new Error("Run not found.");
    if (row.status !== "pending") return "existing" as const;
    const [busy] = await tx.select({ id: documentationRuns.id }).from(documentationRuns).where(eq(documentationRuns.status, "running")).limit(1);
    if (busy) return "busy" as const;
    const next = claim(row);
    if (!next) return "existing" as const;
    await tx.update(documentationRuns).set({ ...next, updatedAt: new Date() }).where(eq(documentationRuns.id, id));
    return "claimed" as const;
  });
}

export async function findRunForProposal(repository: string, proposalId: string) {
  const [row] = await getDatabase().select({ id: documentationRuns.id }).from(documentationRuns)
    .where(and(eq(documentationRuns.repository, repository), sql`${documentationRuns.payload}->'retainedProposal'->>'proposalId' = ${proposalId}`))
    .orderBy(desc(documentationRuns.createdAt)).limit(1);
  return row ?? null;
}
