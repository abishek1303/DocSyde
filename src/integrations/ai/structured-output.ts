import "server-only";
import { z } from "zod";

export class ModelError extends Error {
  constructor(public readonly code: string, public readonly retryAfterSeconds?: number) { super(`Model invocation failed: ${code}`); }
}

export function parseStructuredOutput<S extends z.ZodType>(text: string, schema: S): z.output<S> {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ModelError("invalid-json"); }
  const validated = schema.safeParse(parsed);
  if (!validated.success) throw new ModelError("schema-mismatch");
  return validated.data;
}
