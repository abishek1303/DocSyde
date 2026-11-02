import { modelDiagnosticSchema } from "@/integrations/ai/model-diagnostic";
import { storedRequestInput, storedResponsePayload } from "@/integrations/ai/invocation-payload";
import { debugSection, validationMessage, debugPolicy, debugRequestSchema, debugOutputSchema, validationDiagnosticSchema, DEBUG_LIMITS } from "@/integrations/ai/invocation-debug";
import { z } from "zod";
const configSchema = z.object({ contractVersion: z.string().max(100).nullable(), maxOutputTokens: z.number().int().positive(),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).nullable(), temperature: z.number().nullable(), topP: z.number().nullable() }).strict();
function boundedParse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> | null {
  try { const json = JSON.stringify(value); if (!json || Buffer.byteLength(json) > DEBUG_LIMITS.column) return null;
    const result = schema.safeParse(value); return result.success ? result.data : null; } catch { return null; }
}
export function invocationDebugView(row: { status?: string; operation: string; failureKind: string | null; requestPayload?: unknown; responsePayload?: unknown;
  diagnostic?: unknown; inferenceConfig?: unknown; requestOmissionReason?: string | null; responseOmissionReason?: string | null }) {
  const policy = debugPolicy(row.operation);
  const semantic = row.failureKind === "correspondence-rejection" || row.failureKind === "grounding-rejection";
  const request = policy.input ? boundedParse(debugRequestSchema, row.requestPayload) : null;
  const response = policy.output ? boundedParse(debugOutputSchema, row.responsePayload) : null;
  const projection = storedResponsePayload(row.operation, row.responsePayload);
  const legacyInput = storedRequestInput(row.operation, row.requestPayload);
  const diagnostic = boundedParse(validationDiagnosticSchema, row.diagnostic);
  const boundary = boundedParse(modelDiagnosticSchema, row.diagnostic)?.boundary ?? diagnostic?.boundary;
  const boundaryMessage = boundary ? `Attempt ${boundary.attempt}: ${boundary.attempt === 2 ? "format retry; " : ""}${boundary.retryReason ? "format retry requested" : boundary.canonical === "rejected" ? "strict schema rejected" : boundary.canonical !== "accepted" ? "format rejected" : boundary.wrapper || boundary.ignoredCount ? "normalized provider fields" : boundary.extraction !== "none" ? "recovered JSON" : "accepted directly"}; extraction: ${boundary.extraction}; ignored keys: ${boundary.ignoredCount}${boundary.wrapper ? `; wrapper: ${boundary.wrapper}` : ""}.` : null;
  return { boundaryMessage, request, input: request?.input ?? (legacyInput === undefined ? undefined : debugSection(legacyInput, DEBUG_LIMITS.input)),
    response: response ?? (projection === undefined ? null : { version: 1, validation: "schema-valid", output: debugSection(JSON.stringify(projection), DEBUG_LIMITS.output) }), diagnostic, diagnosticMessage: diagnostic ? validationMessage(diagnostic.code) : null, config: boundedParse(configSchema, row.inferenceConfig),
    requestAvailability: request ? "Retained sanitized snapshot" : "Unavailable — no approved snapshot retained",
    responseAvailability: response ? (row.operation === "source-analysis" && configSchema.safeParse(row.inferenceConfig).data?.contractVersion === "source-analysis-v3" ? "Retained model-returned citation references; evidence excerpts are reconstructed separately in the canonical run analysis" : row.operation === "runtime-decision" && configSchema.safeParse(row.inferenceConfig).data?.contractVersion === "runtime-decision-v3" ? "Retained compact routing references; canonical targets and citations are resolved separately in the run decision" : "Retained schema-valid output") : projection !== undefined ? "Retained validated projection; full response unavailable" : "Unavailable — no approved schema-valid output retained",
    validation: semantic ? "Semantic / post-validation rejection after schema-valid generation"
      : row.failureKind === "schema-mismatch" || row.failureKind === "invalid-json" ? "Generation / schema-validation failure"
      : row.failureKind ? "Generation / provider failure" : row.status === "structured-success" ? "Schema accepted; grounding/correspondence pending" : row.status === "succeeded" && boundary ? "Schema accepted; operation validation completed" : "No rejection recorded" };
}
