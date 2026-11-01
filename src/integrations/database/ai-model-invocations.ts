import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDatabase } from "./client";
import { aiModelInvocations, documentationRuns } from "./schema";

type Row = typeof aiModelInvocations.$inferInsert;
export async function insertAiModelInvocation(row: Row) {
  await getDatabase().transaction(async tx => {
    await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
    await tx.insert(aiModelInvocations).values(row);
  });
}
export async function updateAiModelInvocation(id: string, values: Partial<Omit<Row, "id" | "createdAt" | "runId" | "stage" | "operation" | "provider">>, validationOnly = false, operation?: string) {
  await getDatabase().transaction(async tx => {
    await tx.execute(sql`SET LOCAL statement_timeout = '5000ms'`);
    await tx.update(aiModelInvocations).set(values).where(and(eq(aiModelInvocations.id, id),
      validationOnly ? eq(aiModelInvocations.status, "structured-success") : undefined,
      operation ? eq(aiModelInvocations.operation, operation) : undefined));
  });
}
export async function selectAiModelInvocations(runId: string) {
  // No diagnostic or payload content in the product projection.
  return getDatabase().select({ id: aiModelInvocations.id, stage: aiModelInvocations.stage,
    operation: aiModelInvocations.operation, provider: aiModelInvocations.provider, model: aiModelInvocations.model,
    status: aiModelInvocations.status, failureKind: aiModelInvocations.failureKind,
    completionReason: aiModelInvocations.completionReason, inputTokens: aiModelInvocations.inputTokens,
    outputTokens: aiModelInvocations.outputTokens, elapsedMs: aiModelInvocations.elapsedMs, createdAt: aiModelInvocations.createdAt,
  }).from(aiModelInvocations).where(eq(aiModelInvocations.runId, runId))
    .orderBy(desc(aiModelInvocations.createdAt), desc(aiModelInvocations.id)).limit(101);
}

export async function selectRepositoryAiInvocations(repository: string, runId?: string, stage?: string, options: { status?: string; provider?: string; limit?: number; offset?: number } = {}) {
  return getDatabase().select({ id: aiModelInvocations.id, runId: documentationRuns.id,
    stage: aiModelInvocations.stage, operation: aiModelInvocations.operation, provider: aiModelInvocations.provider,
    model: aiModelInvocations.model, status: aiModelInvocations.status, failureKind: aiModelInvocations.failureKind,
    completionReason: aiModelInvocations.completionReason, inputTokens: aiModelInvocations.inputTokens,
    outputTokens: aiModelInvocations.outputTokens, elapsedMs: aiModelInvocations.elapsedMs, createdAt: aiModelInvocations.createdAt,
  }).from(aiModelInvocations).innerJoin(documentationRuns, eq(aiModelInvocations.runId, documentationRuns.id))
    .where(and(eq(documentationRuns.repository, repository), runId ? eq(aiModelInvocations.runId, runId) : undefined,
      stage ? eq(aiModelInvocations.stage, stage) : undefined,
      options.status ? eq(aiModelInvocations.status, options.status) : undefined,
      options.provider ? eq(aiModelInvocations.provider, options.provider) : undefined))
    .orderBy(desc(aiModelInvocations.createdAt), desc(aiModelInvocations.id)).limit(options.limit ?? 101).offset(options.offset ?? 0);
}

export async function findAiModelInvocation(id: string) {
  // Keep payload columns SQL-only, including on the detail reader.
  const [row] = await getDatabase().select({ id: aiModelInvocations.id, runId: aiModelInvocations.runId,
    stage: aiModelInvocations.stage, operation: aiModelInvocations.operation, provider: aiModelInvocations.provider,
    model: aiModelInvocations.model, status: aiModelInvocations.status, failureKind: aiModelInvocations.failureKind,
    completionReason: aiModelInvocations.completionReason, inputTokens: aiModelInvocations.inputTokens,
    outputTokens: aiModelInvocations.outputTokens, elapsedMs: aiModelInvocations.elapsedMs,
    diagnostic: aiModelInvocations.diagnostic, createdAt: aiModelInvocations.createdAt,
  }).from(aiModelInvocations).where(eq(aiModelInvocations.id, id)).limit(1);
  return row ?? null;
}
