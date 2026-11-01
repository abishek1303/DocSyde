export type RunInvocationSummary = {
  id: string; stage: string; operation: string; provider: string; model: string | null;
  status: string; failureKind: string | null; completionReason: string | null;
  inputTokens: number | null; outputTokens: number | null; elapsedMs: number | null; createdAt: string;
};
export type RunInvocationSummaries = { invocations: RunInvocationSummary[]; omittedEarlier: boolean };

export type ModelUsageSummary = RunInvocationSummary & { runId: string };
