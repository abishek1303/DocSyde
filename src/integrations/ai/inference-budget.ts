import "server-only";
import { reliabilityContext } from "@/integrations/reliability/execution-context";
import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";
import { inferenceSnapshot, runInferencePolicy, type RunInferenceLimits, type ResolvedInference } from "./operation-policy";

export type FrozenInference = { provider: "baseten" | "meta"; model: string; config: Omit<ReturnType<typeof inferenceSnapshot>, "contractVersion"> & { contractVersion: string | null } };
type Budget = {
  runId: string;
  expected?: Record<string, FrozenInference>;
  limits: RunInferenceLimits;
  tokens: number;
  workItems: number;
  startedAt: number;
  calls: number;
  operations: Set<string>;
  stopped: boolean;
  beforeCall?: () => Promise<void>;
};
const scope = new AsyncLocalStorage<Budget>();
export class InferenceBudgetError extends Error {
  constructor(public readonly code: "outside-single-batch-scope" | "inference-budget-stopped" | "inference-config-drift" | "inference-budget-exceeded" | "unguarded-baseline-call" | "inference-log-unavailable") {
    super(code);
  }
}

/** Operator-only experiment scope. Does not change provider settings or contracts. */
export function withInferenceBudget<T>(runId: string, expected: Record<string, FrozenInference>, action: () => Promise<T>, beforeCall?: () => Promise<void>, limits: Partial<RunInferenceLimits> = {}) {
  return scope.run(newBudget(runId, limits, expected, beforeCall), action);
}
function newBudget(runId: string, limits: Partial<RunInferenceLimits>, expected?: Record<string, FrozenInference>, beforeCall?: () => Promise<void>): Budget {
  const resolved = { ...runInferencePolicy, ...limits };
  if (Object.values(resolved).some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error("Invalid run inference limits.");
  return { runId, expected, limits: resolved, calls: 0, tokens: 0, workItems: 0, startedAt: Date.now(), operations: new Set(), stopped: false, beforeCall };
}
/** Reuse an enclosing production/verification scope instead of resetting its counters. */
export function withRunInferenceBudget<T>(runId: string, action: () => Promise<T>, limits: Partial<RunInferenceLimits> = {}) {
  const current = scope.getStore();
  if (current) {
    if (current.runId !== runId) throw new InferenceBudgetError("unguarded-baseline-call");
    return action();
  }
  return scope.run(newBudget(runId, limits), action);
}
export function inferenceBudgetUsage() {
  const budget = scope.getStore();
  return budget ? { calls: budget.calls, reservedTokens: budget.tokens, workItems: budget.workItems, elapsedMs: Date.now() - budget.startedAt } : null;
}
function exhaust(budget: Budget): never { budget.stopped = true; throw new InferenceBudgetError("inference-budget-exceeded"); }
export function admitWorkItems(count: number) {
  const budget = scope.getStore();
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid work item count.");
  if (budget) {
    if (budget.workItems + count > budget.limits.maxWorkItems) exhaust(budget);
    budget.workItems += count;
  }
}
// Explicit experiment scopes disable format retries; production retries still consume the shared budget.
export function formatRetryAllowed() { return !scope.getStore()?.expected; }
// Fail-fast experiments stay fail-fast. Independent production batches can still be support-checked.
export function stopInferenceBudget() { const budget = scope.getStore(); if (budget?.expected) budget.stopped = true; }
export function assertInferenceTransport() {
  if (reliabilityContext()?.mode === "scenario") {
    const budget = scope.getStore();
    if (!budget) throw new InferenceBudgetError("unguarded-baseline-call");
    if (budget.stopped) throw new InferenceBudgetError("inference-budget-stopped");
  }
}
export function requireInferenceLog(inserted: boolean) {
  if (scope.getStore()?.expected && !inserted) { stopInferenceBudget(); throw new InferenceBudgetError("inference-log-unavailable"); }
}
/** Compatibility entry for existing harness callers. Feasibility failures belong to proposal coverage. */
export function assertPlannedGenerationBatches(count: number, _infeasible = false) {
  void _infeasible;
  const budget = scope.getStore();
  if (!Number.isSafeInteger(count) || count < 0 || count > (budget?.limits.maxWorkItems ?? runInferencePolicy.maxWorkItems)) {
    if (budget) exhaust(budget);
    throw new InferenceBudgetError("inference-budget-exceeded");
  }
}
export async function admitInference(provider: "baseten" | "meta", operation: string, settings: ResolvedInference, runId?: string, inputTokens = 0) {
  const budget = scope.getStore();
  if (!budget) {
    if (process.env.DOCSYDE_RELIABILITY_MANIFEST || reliabilityContext()?.mode === "scenario") throw new InferenceBudgetError("unguarded-baseline-call");
    return;
  }
  if (budget.stopped) throw new InferenceBudgetError("inference-budget-stopped");
  if (budget.runId !== (runId ?? (!budget.expected ? budget.runId : undefined))) { budget.stopped = true; throw new InferenceBudgetError("unguarded-baseline-call"); }
  if (budget.expected) {
    const expected = budget.expected[operation];
    if (!expected || !isDeepStrictEqual(expected, { provider, model: settings.model, config: inferenceSnapshot(operation, settings) })) {
      budget.stopped = true; throw new InferenceBudgetError("inference-config-drift");
    }
    // Repeated independent authoring/support/composition/vision calls are legitimate work, not retries.
    if (budget.operations.has(operation) && !["documentation-transformation", "transformation-support", "documentation-composition", "runtime-vision"].includes(operation)) exhaust(budget);
  }
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || inputTokens > budget.limits.maxInputTokensPerCall
    || budget.calls >= budget.limits.maxCalls || budget.tokens + inputTokens + settings.maxOutputTokens > budget.limits.maxTokens
    || Date.now() - budget.startedAt >= budget.limits.maxElapsedMs) exhaust(budget);
  // Reserve the full output ceiling and conservative input charge before any asynchronous dispatch.
  budget.calls++; budget.tokens += inputTokens + settings.maxOutputTokens; budget.operations.add(operation);
  try { await budget.beforeCall?.(); if (Date.now() - budget.startedAt >= budget.limits.maxElapsedMs) exhaust(budget); if (budget.stopped) throw new InferenceBudgetError("inference-budget-stopped"); }
  catch (error) { budget.stopped = true; throw error; }
}
