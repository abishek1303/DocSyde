import "server-only";
import { BoundaryError, boundaryPolicies, boundaryExtraKeyPolicies, newBoundaryTrace, normalizeModelBoundary, parseOrExtractSingleJson } from "./model-boundary";
import { basetenStructuredOutput } from "./baseten/structured-output";
import { formatRetryAllowed } from "./inference-budget";
import { receiptResponse } from "./invocation-payload";
import { resolveInference, type InferenceOptions } from "./operation-policy";
import { logStructuredInvocation } from "./invocation-log";
import type { InvocationContext } from "./invocation-context";
import type { ModelInvocationMetadata } from "./model-diagnostic";
import { z } from "zod";
import { invokeBaseten, BasetenError } from "@/integrations/ai/baseten/invoke";
import { ModelError, parseStructuredOutput } from "@/integrations/ai/structured-output";
export { ModelError } from "@/integrations/ai/structured-output";

export async function generateStructured<S extends z.ZodType>(options: {
  inference?: InferenceOptions; invocation?: InvocationContext; postValidation?: boolean; instructions: string; input: string; schema: S; maxOutputTokens?: number; signal?: AbortSignal;
}): Promise<{ data: z.output<S>; model: string; elapsedMs: number; metadata?: ModelInvocationMetadata; invocationId?: string }> {
  const { instructions, input, schema, signal } = options;
  const operation = options.invocation?.operation ?? "structured-generation";
  const settings = resolveInference("baseten", operation, options.maxOutputTokens, options.inference);
  const maxOutputTokens = settings.maxOutputTokens;
  if (!instructions.trim() || !input.trim() || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) throw new ModelError("invalid-input");
  let jsonSchema: z.core.JSONSchema.BaseSchema;
  let format: string;
  try { jsonSchema = z.toJSONSchema(schema); format = JSON.stringify(jsonSchema); } catch { throw new ModelError("unsupported-schema"); }
  const structured = basetenStructuredOutput(settings.model, operation, jsonSchema);
  const native = structured.metadata.mode === "native";
  const wrappers = boundaryPolicies[operation];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const corrective = attempt === 2 ? "\nReturn only one valid JSON object matching the requested structure. No prose or wrapper." : "";
    const systemInstructions = native ? instructions : `${instructions}\nReturn only JSON matching this schema: ${format}${corrective}`;
    try {
      return await logStructuredInvocation({ invocation: options.invocation, postValidation: options.postValidation, attempt, provider: "baseten", input, settings, instructions: systemInstructions, schema: format, structuredOutput: structured.metadata,
        validatedOutput: result => result.data,
        acceptedResponse: result => operation === "repository-discovery" ? { operation: "repository-discovery", payload: { fieldCount: 4 } } : operation === "repository-understanding" ? { operation: "repository-understanding", payload: { fieldCount: 6 } } : operation === "receipt-verification" ? receiptResponse(result.data) : undefined,
      }, async () => {
        const started = Date.now();
        const result = await invokeBaseten({ instructions: systemInstructions, input, maxOutputTokens, signal, settings, responseFormat: structured.responseFormat }).catch((error: unknown) => {
          throw error instanceof BasetenError ? new ModelError(error.code, error.retryAfterSeconds, { ...error.diagnostic, kind: error.diagnostic?.kind ?? "provider-failure", attempt }) : new ModelError("upstream");
        });
        const trace = newBoundaryTrace(result.text, attempt);
        try {
          let payload: unknown;
          if (native) {
            try { payload = JSON.parse(result.text); trace.strictParse = true; }
            catch { throw new ModelError("invalid-json"); }
            trace.boundary = trace.normalization = "accepted";
          } else payload = parseOrExtractSingleJson(result.text, trace);
          const normalized = !native && wrappers ? normalizeModelBoundary(payload, schema, trace, wrappers, boundaryExtraKeyPolicies[operation]) : payload;
          const data = parseStructuredOutput(JSON.stringify(normalized), schema, operation === "product-impact");
          trace.canonical = "accepted";
          return { data, model: result.model, elapsedMs: Date.now() - started, metadata: { ...result.metadata, boundary: trace } };
        } catch (error) {
          trace.canonical = "rejected";
          if (error instanceof BoundaryError) {
            if (!native && attempt === 1 && formatRetryAllowed()) trace.retryReason = error.code;
            const code = error.code === "boundary-shape" ? "schema-mismatch" : "invalid-json";
            throw new ModelError(code, undefined, { ...result.metadata, kind: code, boundary: trace });
          }
          trace.canonical = "rejected";
          if (error instanceof ModelError) throw new ModelError(error.code, undefined, { ...result.metadata,
            boundary: trace, kind: error.code === "invalid-json" ? "invalid-json" : "schema-mismatch", ...error.diagnostic });
          throw error;
        }
      });
    } catch (error) {
      if (native || (operation === "repository-understanding" || operation === "repository-discovery") || !(error instanceof ModelError) || !error.diagnostic?.boundary?.retryReason || attempt === 2) throw error;
    }
  }
  throw new ModelError("invalid-json");
}
