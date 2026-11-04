import { z } from "zod";

// Fixed public structural vocabulary only; never arbitrary provider-authored key names.
export const diagnosticShapeKey = z.enum(["purpose", "audience", "terminology", "workflows", "surfaces", "gaps", "impact", "result", "analysis", "summary", "title", "metadata", "rationale", "provenance", "source", "runtime", "captures", "sourceReferences", "visualReferences", "repository", "claims", "assessment", "contradictions", "uncertainties", "$schema", "type", "properties"]);
export const boundaryTraceSchema = z.object({
  attempt: z.number().int().min(1).max(2), strictParse: z.boolean(),
  extraction: z.enum(["none", "bom", "fence", "surrounded", "failed", "ambiguous"]),
  boundary: z.enum(["pending", "accepted", "rejected"]), normalization: z.enum(["pending", "accepted", "rejected"]),
  canonical: z.enum(["pending", "accepted", "rejected"]),
  ignoredKeys: z.array(diagnosticShapeKey).max(8), ignoredCount: z.number().int().nonnegative(),
  rootShape: z.object({
    expectedKeys: z.array(diagnosticShapeKey).max(16), receivedKeys: z.array(diagnosticShapeKey).max(16),
    withheldKeyCount: z.number().int().nonnegative(), shape: z.enum(["object", "array", "scalar"]),
  }).strict().optional(),
  wrapper: z.enum(["result", "analysis", "impact"]).optional(),
  retryReason: z.enum(["invalid-json", "boundary-shape"]).optional(),
  outputSha256: z.string().regex(/^[a-f0-9]{64}$/), outputBytes: z.number().int().nonnegative(),
}).strict();
export type BoundaryTrace = z.infer<typeof boundaryTraceSchema>;
// Closed vocabulary: provider error bodies may echo credentials or rejected input.
export const providerErrorSchema = z.object({
  httpStatus: z.number().int().min(400).max(599),
  type: z.enum(["invalid_request_error", "authentication_error", "rate_limit_error", "server_error"]).nullable(),
  code: z.enum(["invalid_json_schema", "invalid_schema", "unsupported_parameter", "unsupported_value", "invalid_api_key", "model_not_found", "rate_limit_exceeded", "server_shutting_down", "service_overloaded", "backend_unavailable", "payload_too_large", "gateway_timeout", "content_policy_violation"]).nullable(),
  parameter: z.enum(["model", "messages", "max_completion_tokens", "max_output_tokens", "max_tokens", "reasoning_effort", "response_format", "response_format.json_schema", "response_format.json_schema.schema", "response_format.json_schema.strict", "temperature", "top_p", "stream"]).nullable(),
  message: z.enum(["Strict JSON schema does not support oneOf or allOf.", "Reasoning effort none is not supported.", "Request parameter is not supported.", "Provider error details withheld."]),
}).strict();
export const diagnosticInvariant = z.enum(["uncertain-element-must-have-null-bounds", "bounds-edges-must-increase"]);
export const modelDiagnosticSchema = z.object({
  kind: z.enum(["invalid-json", "schema-mismatch", "incomplete-output", "invalid-response", "refused", "grounding-rejection", "timeout", "cancelled", "provider-failure", "structured-output"]),
  attempt: z.number().int().min(1).max(2).optional(),
  boundary: boundaryTraceSchema.optional(),
  providerError: providerErrorSchema.optional(),
  model: z.string().max(300).optional(), elapsedMs: z.number().nonnegative().optional(),
  completionReason: z.enum(["stop", "length", "content_filter", "tool_calls", "other"]).optional(),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative().optional(), completion_tokens: z.number().int().nonnegative().optional(), completion_tokens_details: z.object({ reasoning_tokens: z.number().int().nonnegative().optional() }).strip().optional().catch(undefined), total_tokens: z.number().int().nonnegative().optional() }).strict().optional(),
  visibleResponse: z.object({ bytes: z.number().int().nonnegative(), characters: z.number().int().nonnegative() }).strict().optional(),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).nullable().optional(),
  issues: z.array(z.object({ code: z.string().max(60), path: z.string().max(300), category: z.literal("cross-field").optional(), invariant: diagnosticInvariant.optional(), unexpectedKeys: z.array(diagnosticShapeKey).max(8).optional(), extraKeyCount: z.number().int().nonnegative().optional(), withheldKeyCount: z.number().int().nonnegative().optional() }).strict()).max(8).optional(),
  schemaFailure: z.object({ schemaSha256: z.string().regex(/^[a-f0-9]{64}$/), outputSha256: z.string().regex(/^[a-f0-9]{64}$/), outputBytes: z.number().int().nonnegative() }).strict().optional(),
}).strict();
export type ModelDiagnostic = z.infer<typeof modelDiagnosticSchema>;

export type ModelInvocationMetadata = Omit<ModelDiagnostic, "kind" | "issues" | "schemaFailure">;
