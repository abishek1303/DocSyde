import { z } from "zod";

// Fixed public structural vocabulary only; never arbitrary provider-authored key names.
export const diagnosticShapeKey = z.enum(["impact", "result", "analysis", "summary", "title", "metadata", "rationale", "provenance", "source", "runtime", "captures", "sourceReferences", "visualReferences", "repository", "claims", "assessment", "contradictions", "uncertainties", "$schema", "type", "properties"]);
export const boundaryTraceSchema = z.object({
  attempt: z.number().int().min(1).max(2), strictParse: z.boolean(),
  extraction: z.enum(["none", "bom", "fence", "surrounded", "failed", "ambiguous"]),
  boundary: z.enum(["pending", "accepted", "rejected"]), normalization: z.enum(["pending", "accepted", "rejected"]),
  canonical: z.enum(["pending", "accepted", "rejected"]),
  ignoredKeys: z.array(diagnosticShapeKey).max(8), ignoredCount: z.number().int().nonnegative(),
  wrapper: z.enum(["result", "analysis", "impact"]).optional(),
  retryReason: z.enum(["invalid-json", "boundary-shape"]).optional(),
  outputSha256: z.string().regex(/^[a-f0-9]{64}$/), outputBytes: z.number().int().nonnegative(),
}).strict();
export type BoundaryTrace = z.infer<typeof boundaryTraceSchema>;
export const modelDiagnosticSchema = z.object({
  kind: z.enum(["invalid-json", "schema-mismatch", "incomplete-output", "invalid-response", "refused", "grounding-rejection", "timeout", "cancelled", "provider-failure", "structured-output"]),
  attempt: z.number().int().min(1).max(2).optional(),
  boundary: boundaryTraceSchema.optional(),
  model: z.string().max(300).optional(), elapsedMs: z.number().nonnegative().optional(),
  completionReason: z.enum(["stop", "length", "content_filter", "tool_calls", "other"]).optional(),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative().optional(), completion_tokens: z.number().int().nonnegative().optional(), total_tokens: z.number().int().nonnegative().optional() }).strict().optional(),
  issues: z.array(z.object({ code: z.string().max(60), path: z.string().max(300), unexpectedKeys: z.array(diagnosticShapeKey).max(8).optional(), extraKeyCount: z.number().int().nonnegative().optional(), withheldKeyCount: z.number().int().nonnegative().optional() }).strict()).max(8).optional(),
  schemaFailure: z.object({ schemaSha256: z.string().regex(/^[a-f0-9]{64}$/), outputSha256: z.string().regex(/^[a-f0-9]{64}$/), outputBytes: z.number().int().nonnegative() }).strict().optional(),
}).strict();
export type ModelDiagnostic = z.infer<typeof modelDiagnosticSchema>;

export type ModelInvocationMetadata = Omit<ModelDiagnostic, "kind" | "issues" | "schemaFailure">;
