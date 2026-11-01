import "server-only";
import { randomUUID } from "node:crypto";
import { insertAiModelInvocation, updateAiModelInvocation } from "@/integrations/database/ai-model-invocations";
import { modelDiagnosticSchema, type ModelInvocationMetadata } from "./model-diagnostic";
import { ModelError } from "./structured-output";
import type { InvocationContext } from "./invocation-context";

import { configuredModel, inferenceSnapshot, resolveInference, type ResolvedInference } from "./operation-policy";
import { requestPayload, responseAllowed, responsePayload, type ApprovedInvocationResponse } from "./invocation-payload";

function warn(id: string) { console.warn("AI invocation log unavailable.", id); }
function metadata(value?: ModelInvocationMetadata) {
  const parsed = modelDiagnosticSchema.safeParse({ ...value, kind: "provider-failure" });
  const safe = parsed.success ? parsed.data : undefined;
  const count = (n?: number) => n !== undefined && Number.isSafeInteger(n) && n >= 0 ? n : null;
  return { model: safe?.model?.slice(0, 300) ?? null, completionReason: safe?.completionReason ?? null,
    inputTokens: count(safe?.usage?.prompt_tokens), outputTokens: count(safe?.usage?.completion_tokens) };
}

/** Retain only allowlisted debug representations; never transport bodies or instructions. */
export async function logStructuredInvocation<T extends { model: string; metadata?: ModelInvocationMetadata }>(
  options: { invocation?: InvocationContext; provider: "baseten" | "meta"; postValidation?: boolean; input?: string; settings?: ResolvedInference; acceptedResponse?: (result: T) => ApprovedInvocationResponse | undefined },
  invoke: () => Promise<T>,
): Promise<T & { invocationId?: string }> {
  const id = randomUUID(), context = options.invocation ?? { stage: "standalone", operation: options.provider === "meta" ? "runtime-vision" : "structured-generation" };
  const configured = options.settings?.model ?? configuredModel(options.provider);
  let inserted = false;
  try {
    const request = requestPayload(context.operation, options.input);
    const config = inferenceSnapshot(context.operation, options.settings ?? resolveInference(options.provider, context.operation));
    await insertAiModelInvocation({ id, runId: context.runId ?? null, stage: context.stage, operation: context.operation,
      provider: options.provider, model: configured.slice(0, 300), status: "started", createdAt: new Date(),
      requestPayload: request.payload, requestOmissionReason: request.reason, responsePayload: null,
      responseOmissionReason: responseAllowed(context.operation) ? "pending-validation" : "not-allowlisted", inferenceConfig: config });
    inserted = true;
  } catch { warn(id); }
  const started = Date.now();
  try {
    const result = await invoke();
    const elapsedMs = Date.now() - started;
    if (inserted) {
      try {
        let response: { payload: unknown; reason: string | null } = options.postValidation ? { payload: null, reason: responseAllowed(context.operation) ? "pending-validation" : "not-allowlisted" }
          : { payload: null, reason: "not-allowlisted" };
        if (!options.postValidation) {
          try { response = responsePayload(context.operation, options.acceptedResponse?.(result)); }
          catch { response = { payload: null, reason: "logging-data-invalid" }; }
        }
        await updateAiModelInvocation(id, { ...metadata(result.metadata), model: result.model.slice(0, 300), elapsedMs,
          status: options.postValidation ? "structured-success" : "succeeded", responsePayload: response.payload, responseOmissionReason: response.reason });
      } catch { warn(id); }
    }
    return { ...result, invocationId: inserted ? id : undefined };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    if (inserted) {
      const diagnostic = error instanceof ModelError ? modelDiagnosticSchema.safeParse(error.diagnostic) : undefined;
      const safe = diagnostic?.success ? diagnostic.data : undefined;
      // Codes originate at our integration boundary; never persist Error.message.
      const knownCodes = new Set(["invalid-json", "schema-mismatch", "incomplete-output", "refused", "invalid-response", "timeout", "cancelled", "missing-credentials", "invalid-request", "unauthorized", "forbidden", "billing", "model-unavailable", "rate-limited", "upstream"]);
      const code = error instanceof ModelError && knownCodes.has(error.code) ? error.code : "provider-failure";
      try { await updateAiModelInvocation(id, { ...metadata(safe), model: safe?.model ?? configured.slice(0, 300),
        elapsedMs, status: "failed", failureKind: code, diagnostic: safe ?? null, responsePayload: null, responseOmissionReason: "model-failure" }); } catch { warn(id); }
    }
    throw error;
  }
}

/** Called only beside existing feature validators. Does not alter provider metadata. */
export async function finishInvocationValidation(id: string | undefined, rejection?: "grounding-rejection" | "correspondence-rejection", accepted?: () => ApprovedInvocationResponse) {
  if (!id) return;
  let response: { payload: unknown; reason: string | null } = { payload: null, reason: rejection ? "validation-rejected" : "not-allowlisted" };
  let operation: string | undefined;
  if (!rejection && accepted) {
    try { const candidate = accepted(); operation = candidate.operation; response = responsePayload(operation, candidate); }
    catch { response = { payload: null, reason: "logging-data-invalid" }; }
  }
  try { await updateAiModelInvocation(id, { status: rejection ? "failed" : "succeeded", failureKind: rejection ?? null,
    responsePayload: response.payload, responseOmissionReason: response.reason }, true, operation); }
  catch { warn(id); }
}

/** Scope the callback to existing validation only, never progress/persistence/downstream work. */
export async function validateInvocation<T>(id: string | undefined, validate: () => T | Promise<T>, rejection: "grounding-rejection" | "correspondence-rejection", accepted?: () => ApprovedInvocationResponse): Promise<T> {
  let result: T;
  try { result = await validate(); }
  catch (error) { await finishInvocationValidation(id, rejection); throw error; }
  await finishInvocationValidation(id, undefined, accepted);
  return result;
}
