import "server-only";
import { getDocumentationRun } from "./run-operations";
import { selectAiModelInvocations } from "@/integrations/database/ai-model-invocations";
import type { RunInvocationSummaries } from "./run-invocation-summary";

export async function getRunInvocations(id: unknown): Promise<RunInvocationSummaries | null> {
  const run = await getDocumentationRun(id);
  if (!run) return null;
  const rows = await selectAiModelInvocations(run.id);
  return { invocations: rows.slice(0, 100).reverse().map(row => ({ ...row, createdAt: row.createdAt.toISOString() })), omittedEarlier: rows.length > 100 };
}
