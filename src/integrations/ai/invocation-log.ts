import "server-only";
import { assertReliabilitySideEffect, ReliabilityIsolationError } from "@/integrations/reliability/execution-context";
import { admitInference, stopInferenceBudget, requireInferenceLog } from "./inference-budget";
import { randomUUID } from "node:crypto";
import { insertAiModelInvocation, updateAiModelInvocation } from "@/integrations/database/ai-model-invocations";
import { modelDiagnosticSchema, type ModelInvocationMetadata } from "./model-diagnostic";
import { ModelError } from "./structured-output";
import type { InvocationContext } from "./invocation-context";

import { structuredOutputModeSchema, type StructuredOutputMode } from "./structured-output-mode";
import { configuredModel, inferenceSnapshot, resolveInference, type ResolvedInference } from "./operation-policy";
import { debugPolicy, debugRequest, debugOutput, rejectionDiagnostic, validationDiagnosticSchema, type ValidationDiagnostic } from "./invocation-debug";
import { requestPayload, responseAllowed, responsePayload, type ApprovedInvocationResponse } from "./invocation-payload";

function warn(id: string) { console.warn("AI invocation log unavailable.", id); }
function metadata(value?: ModelInvocationMetadata) {
  const parsed = modelDiagnosticSchema.safeParse({ ...value, kind: "provider-failure" });
  const safe = parsed.success ? parsed.data : undefined;
  const count = (n?: number) => n !== undefined && Number.isSafeInteger(n) && n >= 0 ? n : null;
  return { model: safe?.model?.slice(0, 300) ?? null, completionReason: safe?.completionReason ?? null,
    inputTokens: count(safe?.usage?.prompt_tokens), outputTokens: count(safe?.usage?.completion_tokens) };
}

/** Retain only operation-approved snapshots; never transport bodies or raw responses. */
export async function logStructuredInvocation<T extends { model: string; metadata?: ModelInvocationMetadata }>(
  options: { invocation?: InvocationContext; provider: "baseten" | "meta"; postValidation?: boolean; attempt?: number; input?: string; instructions?: string; schema?: string; structuredOutput?: StructuredOutputMode; validatedOutput?: (result: T) => unknown; settings?: ResolvedInference; acceptedResponse?: (result: T) => ApprovedInvocationResponse | undefined },
  invoke: () => Promise<T>,
): Promise<T & { invocationId?: string }> {
  const id = randomUUID(), context = options.invocation ?? { stage: "standalone", operation: options.provider === "meta" ? "runtime-vision" : "structured-generation" };
  const settings = options.settings ?? resolveInference(options.provider, context.operation);
  await admitInference(options.provider, context.operation, settings, context.runId);
  assertReliabilitySideEffect("invocation-persistence");
  const configured = options.settings?.model ?? configuredModel(options.provider);
  let inserted = false;
  try {
    const debug = debugRequest(context.operation, options.instructions, options.input, options.schema);
    const request = debug ? { payload: debug, reason: null } : requestPayload(context.operation, options.input);
    const config = inferenceSnapshot(context.operation, options.settings ?? resolveInference(options.provider, context.operation));
    await insertAiModelInvocation({ id, runId: context.runId ?? null, stage: context.stage, operation: context.operation,
      provider: options.provider, model: configured.slice(0, 300), status: "started", createdAt: new Date(),
      requestPayload: request.payload, requestOmissionReason: request.reason, responsePayload: null,
      responseOmissionReason: (responseAllowed(context.operation) || debugPolicy(context.operation).output) ? "pending-validation" : "not-allowlisted", inferenceConfig: { ...config, ...(options.structuredOutput ? { structuredOutput: structuredOutputModeSchema.parse(options.structuredOutput) } : {}) } });
    inserted = true;
  } catch (error) { if (error instanceof ReliabilityIsolationError) throw error; warn(id); }
  requireInferenceLog(inserted);
  if (options.attempt === 2 && !inserted) throw new ModelError("invocation-log-unavailable");
  const started = Date.now();
  try {
    const result = await invoke();
    const elapsedMs = Date.now() - started;
    if (inserted) {
      try {
        let response: { payload: unknown; reason: string | null } = options.postValidation ? { payload: null, reason: (responseAllowed(context.operation) || debugPolicy(context.operation).output) ? "pending-validation" : "not-allowlisted" }
          : { payload: null, reason: "not-allowlisted" };
        if (!options.postValidation) {
          try { response = responsePayload(context.operation, options.acceptedResponse?.(result)); }
          catch { response = { payload: null, reason: "logging-data-invalid" }; }
        }
        const debug = debugPolicy(context.operation).output && options.validatedOutput ? debugOutput(context.operation, options.validatedOutput(result)) : undefined;
        if (debug) response = { payload: debug, reason: null };
        await updateAiModelInvocation(id, { ...metadata(result.metadata), model: result.model.slice(0, 300), elapsedMs,
          status: options.postValidation ? "structured-success" : "succeeded",
          ...(result.metadata ? { diagnostic: modelDiagnosticSchema.parse({ ...result.metadata, kind: "structured-output", attempt: options.attempt ?? 1 }) } : {}), responsePayload: response.payload, responseOmissionReason: response.reason });
      } catch (error) { if (error instanceof ReliabilityIsolationError) throw error; warn(id); stopInferenceBudget(); }
    }
    return { ...result, invocationId: inserted ? id : undefined };
  } catch (error) {
    if (!(error instanceof ModelError && error.diagnostic?.boundary?.retryReason)) stopInferenceBudget();
    const elapsedMs = Date.now() - started;
    let failureLogged = false;
    if (inserted) {
      const diagnostic = error instanceof ModelError ? modelDiagnosticSchema.safeParse(error.diagnostic) : undefined;
      const safe = diagnostic?.success ? diagnostic.data : undefined;
      // Codes originate at our integration boundary; never persist Error.message.
      const knownCodes = new Set(["invalid-json", "schema-mismatch", "incomplete-output", "refused", "invalid-response", "timeout", "cancelled", "missing-credentials", "invalid-request", "unauthorized", "forbidden", "billing", "model-unavailable", "rate-limited", "upstream"]);
      const code = error instanceof ModelError && knownCodes.has(error.code) ? error.code : "provider-failure";
      try { await updateAiModelInvocation(id, { ...metadata(safe), model: safe?.model ?? configured.slice(0, 300),
        elapsedMs, status: "failed", failureKind: code, diagnostic: safe ?? null, responsePayload: null, responseOmissionReason: "model-failure" }); failureLogged = true; } catch (error) { if (error instanceof ReliabilityIsolationError) throw error; warn(id); }
    }
    // Never issue a paid format retry if its predecessor could not be retained.
    if (!failureLogged && error instanceof ModelError && error.diagnostic?.boundary?.retryReason) {
      const boundary = { ...error.diagnostic.boundary };
      delete boundary.retryReason;
      throw new ModelError(error.code, error.retryAfterSeconds, { ...error.diagnostic, boundary });
    }
    throw error;
  }
}

/** Called only beside existing feature validators. Does not alter provider metadata. */
export async function finishInvocationValidation(id: string | undefined, rejection?: "grounding-rejection" | "correspondence-rejection", accepted?: () => ApprovedInvocationResponse, diagnostic?: ValidationDiagnostic) {
  if (rejection) stopInferenceBudget();
  if (!id) return;
  assertReliabilitySideEffect("invocation-persistence");
  let response: { payload: unknown; reason: string | null } = { payload: null, reason: rejection ? "validation-rejected" : "not-allowlisted" };
  let operation: string | undefined;
  if (!rejection && accepted) {
    try { const candidate = accepted(); operation = candidate.operation; response = responsePayload(operation, candidate); }
    catch { response = { payload: null, reason: "logging-data-invalid" }; }
  }
  // Selection retains the bounded schema-valid snapshot written before correspondence;
  // final acceptance changes status, not the model output. Other operations keep their existing projections.
  try { await updateAiModelInvocation(id, { status: rejection ? "failed" : "succeeded", failureKind: rejection ?? null,
    ...(accepted && !rejection && operation !== "visual-selection" ? { responsePayload: response.payload, responseOmissionReason: response.reason } : {}),
    ...(rejection ? { diagnostic: validationDiagnosticSchema.parse(diagnostic ?? rejectionDiagnostic(undefined, rejection)) } : {}) }, true, operation); }
  catch (error) { if (error instanceof ReliabilityIsolationError) throw error; warn(id); stopInferenceBudget(); }
}

/** Scope the callback to existing validation only, never progress/persistence/downstream work. */
export async function validateInvocation<T>(id: string | undefined, validate: () => T | Promise<T>, rejection: "grounding-rejection" | "correspondence-rejection", accepted?: () => ApprovedInvocationResponse): Promise<T> {
  let result: T;
  try { result = await validate(); }
  catch (error) { await finishInvocationValidation(id, rejection, undefined, rejectionDiagnostic(error, rejection)); throw error; }
  await finishInvocationValidation(id, undefined, accepted);
  return result;
}
