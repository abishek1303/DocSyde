import { formatRetryAllowed } from "./inference-budget";
import { recoveryOutputTokenCap, type ResolvedInference } from "./operation-policy";
import { ModelError } from "./structured-output";

export { maxModelAttempts } from "./demo-reliability";
import { maxModelAttempts, demoReliabilityMode, demoModelLimits } from "./demo-reliability";
/** A smaller initial ceiling can grow only to the operation's configured cap.
 * Unknown operations and explicit frozen experiment scopes cannot grow. */
export function truncationSettings(operation: string, settings: ResolvedInference) {
  const demoLimits = demoReliabilityMode() ? demoModelLimits(operation === "runtime-vision" || operation === "documentation-composition" ? "meta" : "baseten", settings.model) : undefined;
  const cap = demoLimits?.outputCap ?? recoveryOutputTokenCap(operation) ?? settings.maxOutputTokens;
  return { ...settings, maxOutputTokens: Math.min(Math.max(cap, settings.maxOutputTokens), Math.ceil(settings.maxOutputTokens * 1.5)) };
}
export function recoverableModelError(error: unknown, attempt: number, classifyTruncation = false): ModelError | undefined {
  if (!(error instanceof ModelError) || !["invalid-json", "schema-mismatch", "incomplete-output"].includes(error.code) || error.diagnostic?.kind === "grounding-rejection" || attempt >= maxModelAttempts() || !formatRetryAllowed()) return;
  const reason = error.diagnostic?.retryReason ?? error.diagnostic?.boundary?.retryReason
    ?? (classifyTruncation && error.code === "incomplete-output" && error.diagnostic?.completionReason === "length" ? "output-truncated" : undefined);
  if (!reason) return;
  return new ModelError(error.code, error.retryAfterSeconds, { ...error.diagnostic, kind: error.diagnostic?.kind ?? "invalid-json", attempt, retryCount: attempt - 1, retryReason: reason });
}
export function formatCorrection(reason?: string) {
  return reason === "output-truncated"
    ? "\nThe previous completion reached its token ceiling. Return a complete concise JSON response from the same evidence. Preserve all required content, qualifications and exact references. Do not pad or repeat input."
    : "\nReturn only one complete valid JSON object matching the requested schema. No prose or wrapper. Preserve the original evidence and exact references.";
}

/** Native composition/vision may recover syntax, never content or evidence checks. */
export function structuredParseFailure(error: ModelError, metadata: import("./model-diagnostic").ModelInvocationMetadata, attempt: number) {
  const diagnostic: import("./model-diagnostic").ModelDiagnostic = {
    ...metadata, ...error.diagnostic, kind: error.code === "invalid-json" ? "invalid-json" : "schema-mismatch",
    attempt, retryCount: attempt - 1,
  };
  if (error.code === "invalid-json") {
    const recovery = recoverableModelError(new ModelError(error.code, error.retryAfterSeconds, { ...diagnostic, retryReason: "invalid-json" }), attempt);
    if (recovery) return recovery;
  }
  return new ModelError(error.code, error.retryAfterSeconds, diagnostic);
}
