import "server-only";
import { normalizeSourceOutputShape, sourceShapeCorrection } from "./source-output-shape";
import { BoundaryError, boundaryPolicies, boundaryExtraKeyPolicies, newBoundaryTrace, normalizeModelBoundary, parseOrExtractSingleJson } from "./model-boundary";
import { basetenStructuredOutput } from "./baseten/structured-output";
import { proseLengthIssues, proseLengthCorrection, normalizeProseWhitespace, type ProseLengthIssue } from "./prose-length-feedback";
import { maxModelAttempts, recoverableModelError, truncationSettings, formatCorrection } from "./model-output-recovery";
import { demoReliabilityMode } from "./demo-reliability";
import { semanticCorrection, semanticCorrectionInstructions } from "./semantic-recovery";
import type { SemanticCorrection } from "./semantic-correction-policy";
import { formatRetryAllowed } from "./inference-budget";
import { receiptResponse } from "./invocation-payload";
import { resolveInference, type InferenceOptions } from "./operation-policy";
import { logStructuredInvocation } from "./invocation-log";
import type { InvocationContext } from "./invocation-context";
import type { ModelDiagnostic, ModelInvocationMetadata } from "./model-diagnostic";
import { z } from "zod";
import { invokeBaseten, BasetenError } from "@/integrations/ai/baseten/invoke";
import { ModelError, parseStructuredOutput } from "@/integrations/ai/structured-output";
export { ModelError } from "@/integrations/ai/structured-output";

export type StructuredGenerationResult<S extends z.ZodType> = { data: z.output<S>; model: string; elapsedMs: number; metadata?: ModelInvocationMetadata; invocationId?: string };

export async function generateStructured<S extends z.ZodType>(options: {
  validate?: (generated: StructuredGenerationResult<S>) => unknown | Promise<unknown>;
  inference?: InferenceOptions; invocation?: InvocationContext; postValidation?: boolean; instructions: string; input: string; schema: S; maxOutputTokens?: number; signal?: AbortSignal;
}): Promise<{ data: z.output<S>; model: string; elapsedMs: number; metadata?: ModelInvocationMetadata; invocationId?: string }> {
  const { instructions, input, schema, signal } = options;
  const operation = options.invocation?.operation ?? "structured-generation";
  let settings = resolveInference("baseten", operation, options.maxOutputTokens, options.inference);
  const maxOutputTokens = settings.maxOutputTokens;
  if (!instructions.trim() || !input.trim() || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) throw new ModelError("invalid-input");
  let jsonSchema: z.core.JSONSchema.BaseSchema;
  let format: string;
  try { jsonSchema = z.toJSONSchema(schema); format = JSON.stringify(jsonSchema); } catch { throw new ModelError("unsupported-schema"); }
  const structured = basetenStructuredOutput(settings.model, operation, jsonSchema);
  const native = structured.metadata.mode === "native";
  const wrappers = boundaryPolicies[operation];
  let lengthFeedback: ProseLengthIssue[] | undefined;
  let retryReason: ModelDiagnostic["retryReason"];
  let semanticFeedback: SemanticCorrection | undefined;
  let semanticCount = 0;
  let sourceShapeFeedback: string | undefined;
  let sourceShapeRetries = 0;
  for (let attempt = 1; attempt <= maxModelAttempts(); attempt++) {
    signal?.throwIfAborted();
    const semanticMetadata = semanticFeedback ? { semanticCorrection: semanticFeedback, semanticCorrectionCount: semanticCount } : {};
    const corrective = (sourceShapeFeedback ?? "") + (attempt > 1 ? lengthFeedback ? proseLengthCorrection(lengthFeedback) : retryReason === "semantic-correction" ? "" : formatCorrection(retryReason) : "") + (semanticFeedback ? semanticCorrectionInstructions(semanticFeedback) : "");
    const systemInstructions = native ? `${instructions}${corrective}` : `${instructions}\nReturn only JSON matching this schema: ${format}${corrective}`;
    try {
      const generated = await logStructuredInvocation({ invocation: options.invocation, postValidation: options.postValidation || (demoReliabilityMode() && Boolean(options.validate)), attempt, provider: "baseten", input, settings, instructions: systemInstructions, schema: format, structuredOutput: structured.metadata,
        validatedOutput: result => result.data,
        acceptedResponse: result => operation === "repository-discovery" ? { operation: "repository-discovery", payload: { fieldCount: 4 } } : operation === "repository-understanding" ? { operation: "repository-understanding", payload: { fieldCount: 6 } } : operation === "receipt-verification" ? receiptResponse(result.data) : undefined,
      }, async () => {
        const started = Date.now();
        const result = await invokeBaseten({ instructions: systemInstructions, input, maxOutputTokens: settings.maxOutputTokens, signal, settings, responseFormat: structured.responseFormat }).catch((error: unknown) => {
          const failure = error instanceof BasetenError ? new ModelError(error.code, error.retryAfterSeconds, { ...error.diagnostic, kind: error.diagnostic?.kind ?? "provider-failure", attempt, retryCount: attempt - 1, ...semanticMetadata }) : new ModelError("upstream");
          throw recoverableModelError(failure, attempt, true) ?? failure;
        });
        const trace = newBoundaryTrace(result.text, attempt);
        if (attempt > 1 && lengthFeedback) trace.proseLengthIssues = lengthFeedback;
        let normalized: unknown;
        try {
          let payload: unknown;
          if (native) {
            try { payload = JSON.parse(result.text); trace.strictParse = true; }
            catch { throw new ModelError("invalid-json"); }
            trace.boundary = trace.normalization = "accepted";
          } else payload = parseOrExtractSingleJson(result.text, trace);
          normalized = !native && wrappers ? normalizeModelBoundary(payload, schema, trace, wrappers, boundaryExtraKeyPolicies[operation]) : payload;
          normalized = normalizeSourceOutputShape(operation, normalized);
          const prose = normalizeProseWhitespace(operation, schema, normalized);
          normalized = prose.value;
          const data = parseStructuredOutput(JSON.stringify(normalized), schema, operation === "product-impact");
          trace.canonical = "accepted";
          return { data, model: result.model, elapsedMs: Date.now() - started, metadata: { ...result.metadata, attempt, retryCount: attempt - 1, proseNormalized: prose.normalized, ...(semanticFeedback ? { semanticCorrection: semanticFeedback, semanticCorrectionCount: semanticCount } : {}), ...(retryReason ? { retryReason } : {}), boundary: trace } };
        } catch (error) {
          trace.canonical = "rejected";
          if (error instanceof BoundaryError) {
            if (attempt < maxModelAttempts() && formatRetryAllowed() && !(error.code === "boundary-shape" && ["repository-understanding", "repository-discovery"].includes(operation))) trace.retryReason = error.code;
            const code = error.code === "boundary-shape" ? "schema-mismatch" : "invalid-json";
            throw new ModelError(code, undefined, { ...result.metadata, kind: code, attempt, retryCount: attempt - 1, ...semanticMetadata, boundary: trace });
          }
          trace.canonical = "rejected";
          if (error instanceof ModelError) {
            if (error.code === "invalid-json" && attempt < maxModelAttempts() && formatRetryAllowed()) trace.retryReason = "invalid-json";
            if (error.code === "schema-mismatch") {
              const shapeFeedback = sourceShapeCorrection(operation, schema, normalized);
              if (shapeFeedback && sourceShapeRetries < 1 && attempt < maxModelAttempts() && formatRetryAllowed()) {
                sourceShapeFeedback = shapeFeedback; sourceShapeRetries++; trace.retryReason = "source-shape";
              }
              const feedback = proseLengthIssues(operation, schema, normalized);
              if (feedback) {
                trace.proseLengthIssues = feedback;
                if (attempt < maxModelAttempts() && formatRetryAllowed()) {
                  trace.retryReason = "prose-length"; lengthFeedback = feedback;
                }
              }
            }
            throw new ModelError(error.code, undefined, { ...result.metadata,
              attempt, retryCount: attempt - 1, ...semanticMetadata, boundary: trace, kind: error.code === "invalid-json" ? "invalid-json" : "schema-mismatch", ...error.diagnostic });
          }
          throw error;
        }
      });
      if (demoReliabilityMode() && options.validate) {
        try { await options.validate(generated); }
        catch (error) {
          const feedback = operation === "source-analysis" ? undefined : semanticCorrection(error);
          if (!feedback || semanticCount >= 2 || attempt >= maxModelAttempts()) throw error;
          semanticFeedback = feedback; semanticCount++;
          lengthFeedback = undefined; retryReason = "semantic-correction";
          continue;
        }
      }
      return generated;
    } catch (error) {
      const recovery = recoverableModelError(error, attempt);
      if (!recovery) throw error;
      retryReason = recovery.diagnostic?.retryReason;
      if (retryReason !== "prose-length") lengthFeedback = undefined;
      if (retryReason === "output-truncated") settings = truncationSettings(operation, settings);
    }
  }
  throw new ModelError("invalid-json");
}
