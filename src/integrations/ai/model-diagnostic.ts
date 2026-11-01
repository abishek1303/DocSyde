import { z } from "zod";

export const modelDiagnosticSchema = z.object({
  kind: z.enum(["invalid-json", "schema-mismatch", "incomplete-output", "invalid-response", "refused", "grounding-rejection", "timeout", "cancelled", "provider-failure"]),
  model: z.string().max(300).optional(), elapsedMs: z.number().nonnegative().optional(),
  completionReason: z.enum(["stop", "length", "content_filter", "tool_calls", "other"]).optional(),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative().optional(), completion_tokens: z.number().int().nonnegative().optional(), total_tokens: z.number().int().nonnegative().optional() }).strict().optional(),
  issues: z.array(z.object({ code: z.string().max(60), path: z.string().max(300) }).strict()).max(8).optional(),
}).strict();
export type ModelDiagnostic = z.infer<typeof modelDiagnosticSchema>;

export type ModelInvocationMetadata = Omit<ModelDiagnostic, "kind" | "issues">;
