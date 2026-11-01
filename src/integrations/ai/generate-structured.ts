import "server-only";
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
  let format: string;
  try { format = JSON.stringify(z.toJSONSchema(schema)); } catch { throw new ModelError("unsupported-schema"); }
  return logStructuredInvocation({ invocation: options.invocation, postValidation: options.postValidation, provider: "baseten", input, settings, instructions: `${instructions}\nReturn only JSON matching this schema: ${format}`, schema: format,
    validatedOutput: result => result.data,
    acceptedResponse: result => operation === "receipt-verification" ? receiptResponse(result.data) : undefined,
  }, async () => {
    const started = Date.now();
    const result = await invokeBaseten({ instructions: `${instructions}\nReturn only JSON matching this schema: ${format}`, input, maxOutputTokens, signal, settings }).catch((error: unknown) => {
      throw error instanceof BasetenError ? new ModelError(error.code, error.retryAfterSeconds, error.diagnostic) : new ModelError("upstream");
    });
    try {
      return { data: parseStructuredOutput(result.text, schema), model: result.model, elapsedMs: Date.now() - started, metadata: result.metadata };
    } catch (error) {
      if (error instanceof ModelError) throw new ModelError(error.code, undefined, { ...result.metadata,
        kind: error.code === "invalid-json" ? "invalid-json" : "schema-mismatch", ...error.diagnostic });
      throw error;
    }
  });
}
