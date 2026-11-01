import "server-only";
import type { ModelInvocationMetadata } from "./model-diagnostic";
import { z } from "zod";
import { invokeBaseten, BasetenError } from "@/integrations/ai/baseten/invoke";
import { ModelError, parseStructuredOutput } from "@/integrations/ai/structured-output";
export { ModelError } from "@/integrations/ai/structured-output";

export async function generateStructured<S extends z.ZodType>(options: {
  instructions: string; input: string; schema: S; maxOutputTokens?: number; signal?: AbortSignal;
}): Promise<{ data: z.output<S>; model: string; elapsedMs: number; metadata?: ModelInvocationMetadata }> {
  const { instructions, input, schema, signal } = options;
  const maxOutputTokens = options.maxOutputTokens ?? 4096;
  if (!instructions.trim() || !input.trim() || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) throw new ModelError("invalid-input");
  let format: string;
  try { format = JSON.stringify(z.toJSONSchema(schema)); } catch { throw new ModelError("unsupported-schema"); }
  const started = Date.now();
  const result = await invokeBaseten({ instructions: `${instructions}\nReturn only JSON matching this schema: ${format}`, input, maxOutputTokens, signal }).catch((error: unknown) => {
    throw error instanceof BasetenError ? new ModelError(error.code, error.retryAfterSeconds, error.diagnostic) : new ModelError("upstream");
  });
  try {
    return { data: parseStructuredOutput(result.text, schema), model: result.model, elapsedMs: Date.now() - started, metadata: result.metadata };
  } catch (error) {
    if (error instanceof ModelError) throw new ModelError(error.code, undefined, { ...result.metadata,
      kind: error.code === "invalid-json" ? "invalid-json" : "schema-mismatch", ...error.diagnostic });
    throw error;
  }
}
