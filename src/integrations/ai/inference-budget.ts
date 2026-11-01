import "server-only";
import { reliabilityContext } from "@/integrations/reliability/execution-context";
import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";
import { inferenceSnapshot, type ResolvedInference } from "./operation-policy";

export type FrozenInference = { provider: "baseten" | "meta"; model: string; config: Omit<ReturnType<typeof inferenceSnapshot>, "contractVersion"> & { contractVersion: string | null } };
type Budget = {
  runId: string;
  expected: Record<string, FrozenInference>;
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
export function withInferenceBudget<T>(runId: string, expected: Record<string, FrozenInference>, action: () => Promise<T>, beforeCall?: () => Promise<void>) {
  return scope.run({ runId, expected, calls: 0, operations: new Set(), stopped: false, beforeCall }, action);
}
export function stopInferenceBudget() { const budget = scope.getStore(); if (budget) budget.stopped = true; }
export function assertInferenceTransport() {
  if (reliabilityContext()?.mode === "scenario") {
    const budget = scope.getStore();
    if (!budget) throw new InferenceBudgetError("unguarded-baseline-call");
    if (budget.stopped) throw new InferenceBudgetError("inference-budget-stopped");
  }
}
export function requireInferenceLog(inserted: boolean) {
  if (scope.getStore() && !inserted) { stopInferenceBudget(); throw new InferenceBudgetError("inference-log-unavailable"); }
}
export function assertPlannedGenerationBatches(count: number, infeasible = false) {
  if (scope.getStore() && (count !== 1 || infeasible)) {
    stopInferenceBudget();
    throw new InferenceBudgetError("outside-single-batch-scope");
  }
}
export async function admitInference(provider: "baseten" | "meta", operation: string, settings: ResolvedInference, runId?: string) {
  const budget = scope.getStore();
  if (!budget) {
    if (process.env.DOCSYDE_RELIABILITY_MANIFEST || reliabilityContext()?.mode === "scenario") throw new InferenceBudgetError("unguarded-baseline-call");
    return;
  }
  if (budget.stopped) throw new InferenceBudgetError("inference-budget-stopped");
  if (budget.runId !== runId) { budget.stopped = true; throw new InferenceBudgetError("unguarded-baseline-call"); }
  const expected = budget.expected[operation];
  if (!expected || !isDeepStrictEqual(expected, { provider, model: settings.model, config: inferenceSnapshot(operation, settings) })) {
    budget.stopped = true; throw new InferenceBudgetError("inference-config-drift");
  }
  // Every baseline operation is permitted once, including generation and vision.
  if (budget.calls >= 8 || budget.operations.has(operation)) {
    budget.stopped = true; throw new InferenceBudgetError("inference-budget-exceeded");
  }
  // Reserve before awaiting to prevent parallel admissions of the same operation.
  budget.calls++; budget.operations.add(operation);
  try { await budget.beforeCall?.(); if (budget.stopped) throw new InferenceBudgetError("inference-budget-stopped"); }
  catch (error) { budget.stopped = true; throw error; }
}
