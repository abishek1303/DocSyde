import "server-only";
import { z } from "zod";
import { invokeBaseten, BasetenError } from "@/integrations/ai/baseten/invoke";

export class ModelError extends Error {
  constructor(public readonly code: string, public readonly retryAfterSeconds?: number) { super(`Model invocation failed: ${code}`); }
}

export async function generateStructured<S extends z.ZodType>(options: {
  instructions: string; input: string; schema: S; maxOutputTokens?: number; signal?: AbortSignal;
}): Promise<{ data: z.output<S>; model: string; elapsedMs: number }> {
  const { instructions, input, schema, signal } = options;
  const maxOutputTokens = options.maxOutputTokens ?? 4096;
  if (!instructions.trim() || !input.trim() || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) throw new ModelError("invalid-input");
  let format: string;
  try { format = JSON.stringify(z.toJSONSchema(schema)); } catch { throw new ModelError("unsupported-schema"); }
  const started = Date.now();
  const result = await invokeBaseten({ instructions: `${instructions}\nReturn only JSON matching this schema: ${format}`, input, maxOutputTokens, signal }).catch((error: unknown) => {
    throw error instanceof BasetenError ? new ModelError(error.code, error.retryAfterSeconds) : new ModelError("upstream");
  });
  let parsed: unknown;
  try { parsed = JSON.parse(result.text); } catch { throw new ModelError("invalid-json"); }
  const validated = schema.safeParse(parsed);
  if (!validated.success) throw new ModelError("schema-mismatch");
  return { data: validated.data, model: result.model, elapsedMs: Date.now() - started };
}
