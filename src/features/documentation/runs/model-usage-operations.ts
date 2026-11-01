import "server-only";
import { z } from "zod";
import { selectedRepository } from "@/features/sources/product-analysis";
import { findAiModelInvocation, selectRepositoryAiInvocations } from "@/integrations/database/ai-model-invocations";
import { modelDiagnosticSchema } from "@/integrations/ai/model-diagnostic";
import { getDocumentationRun, runView } from "./run-operations";
import { runFailureForView } from "./run-failure";
import type { ModelUsageSummary } from "./run-invocation-summary";

export const MODEL_USAGE_PAGE_SIZE = 25;
export async function listModelUsage(raw: { repository?: string; runId?: string; stage?: string; status?: string; provider?: string; page?: string }) {
  const repository = selectedRepository({ repository: raw.repository });
  const runId = raw.runId ? z.uuid().parse(raw.runId) : undefined;
  const stage = raw.stage ? z.string().trim().min(1).max(100).parse(raw.stage) : undefined;
  const status = raw.status ? z.enum(["started", "structured-success", "succeeded", "failed"]).parse(raw.status) : undefined;
  const provider = raw.provider ? z.enum(["baseten", "meta"]).parse(raw.provider) : undefined;
  const page = z.coerce.number().int().min(1).max(10000).parse(raw.page ?? "1");
  const rows = await selectRepositoryAiInvocations(repository.location.toLowerCase(), runId, stage, {
    status, provider, limit: MODEL_USAGE_PAGE_SIZE + 1, offset: (page - 1) * MODEL_USAGE_PAGE_SIZE,
  });
  const invocations: ModelUsageSummary[] = rows.slice(0, MODEL_USAGE_PAGE_SIZE).map(row => ({
    id: row.id, runId: row.runId, stage: row.stage, operation: row.operation, provider: row.provider,
    model: row.model, status: row.status, failureKind: row.failureKind, completionReason: row.completionReason,
    inputTokens: row.inputTokens, outputTokens: row.outputTokens, elapsedMs: row.elapsedMs, createdAt: row.createdAt.toISOString(),
  }));
  return { repository: repository.name, invocations, page, hasNextPage: rows.length > MODEL_USAGE_PAGE_SIZE };
}

export async function getModelUsage(rawId: unknown) {
  const id = z.uuid().parse(rawId);
  const row = await findAiModelInvocation(id);
  // Standalone calls have no repository authorization context; keep them SQL-only.
  if (!row?.runId) return null;
  const run = await getDocumentationRun(row.runId);
  if (!run) return null;
  const diagnostic = modelDiagnosticSchema.safeParse(row.diagnostic);
  return { id: row.id, runId: run.id, repository: `${run.record.input.owner}/${run.record.input.repo}`,
    stage: row.stage, operation: row.operation, provider: row.provider, model: row.model, status: row.status,
    failureKind: row.failureKind, completionReason: row.completionReason, inputTokens: row.inputTokens,
    outputTokens: row.outputTokens, elapsedMs: row.elapsedMs, createdAt: row.createdAt.toISOString(),
    diagnostic: diagnostic.success ? diagnostic.data : null };
}

export async function getModelFailure(runId: unknown, rawStage: unknown) {
  const run = await getDocumentationRun(runId);
  if (!run) return null;
  const stage = z.string().min(1).max(100).parse(rawStage);
  if (!run.record.stages.some(item => item.key === stage) && stage !== "execution") return null;
  const repository = `${run.record.input.owner}/${run.record.input.repo}`;
  const rows = await selectRepositoryAiInvocations(`https://github.com/${repository.toLowerCase()}`, run.id, stage).catch(() => null);
  const invocation = rows?.find(row => row.status === "failed");
  const failure = runFailureForView(runView(run, { includeResponses: false }));
  return { logsUnavailable: rows === null, invocationId: invocation?.id ?? null, runId: run.id, repository, stage,
    failure: failure?.stage === stage ? failure : null };
}
