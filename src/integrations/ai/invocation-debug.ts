import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { boundaryTraceSchema } from "./model-diagnostic";
import { ModelError } from "./structured-output";

// Per-section UTF-8 budgets leave room for JSON escaping under the 128 KiB column budget.
export const DEBUG_LIMITS = { instructions: 8192, input: 32768, schema: 8192, output: 32768, diagnostic: 4096, column: 128 * 1024 } as const;
const full = { instructions: true, input: true, schema: true, output: true, diagnostic: true } as const;
const deny = { instructions: false, input: false, schema: false, output: false, diagnostic: false } as const;
const policies: Record<string, { instructions: boolean; input: boolean; schema: boolean; output: boolean; diagnostic: boolean }> = {
  "source-analysis": full, "visual-selection": full, "runtime-decision": full, "documentation-planning": full, "product-impact": full,
  "documentation-transformation": { ...full, output: false },
  // Vision retains only its existing bounds/certainty/count projection; never pixels or visible prose.
  "runtime-vision": deny,
};
export function debugPolicy(operation: string) { return Object.hasOwn(policies, operation) ? policies[operation] : deny; }
export function debugHash(text: string) { return createHash("sha256").update(text, "utf8").digest("hex"); }
const secretKey = /^(?:[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)|authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|client_secret|api[-_]?key|access[-_]?token|refresh[-_]?token|credentials|private[-_]?key|env|environment|headers)$/i;
function redactText(text: string): string {
  return text.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
    .replace(/\b(?:Bearer|Basic)\s+[^\s"'\\]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED]")
    .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)|password|api_key|client_secret)\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi, "$1=[REDACTED]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}
function sanitize(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, secretKey.test(key) ? "[REDACTED]" : sanitize(child)]));
  return value;
}
export const debugSectionSchema = z.object({ content: z.string().max(DEBUG_LIMITS.column), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  originalBytes: z.number().int().nonnegative(), retainedBytes: z.number().int().nonnegative(), truncated: z.boolean(), redacted: z.boolean() }).strict();
export type DebugSection = z.infer<typeof debugSectionSchema>;
export function debugSection(original: string, limit: number): DebugSection {
  let clean: string;
  try { const parsed: unknown = JSON.parse(original); const sanitized = sanitize(parsed); clean = JSON.stringify(sanitized) === JSON.stringify(parsed) ? original : JSON.stringify(sanitized); }
  catch { clean = redactText(original); }
  const bytes = Buffer.from(clean, "utf8");
  // Decode only complete UTF-8 codepoints, never retain a partial surrogate/byte sequence.
  const content = new TextDecoder("utf-8").decode(bytes.subarray(0, limit), { stream: true });
  return { content, sha256: debugHash(original), originalBytes: Buffer.byteLength(original), retainedBytes: Buffer.byteLength(content),
    truncated: bytes.length > limit, redacted: clean !== original };
}
export const debugRequestSchema = z.object({ version: z.literal(1), instructions: debugSectionSchema, input: debugSectionSchema, schema: debugSectionSchema }).strict();
export const debugOutputSchema = z.object({ version: z.literal(1), validation: z.literal("schema-valid"), output: debugSectionSchema }).strict();
export function debugRequest(operation: string, instructions?: string, input?: string, schema?: string) {
  if (!debugPolicy(operation).input || instructions === undefined || input === undefined || schema === undefined) return undefined;
  let scale = 1;
  for (;;) {
    const snapshot = { version: 1 as const, instructions: debugSection(instructions, Math.floor(DEBUG_LIMITS.instructions / scale)), input: debugSection(input, Math.floor(DEBUG_LIMITS.input / scale)), schema: debugSection(schema, Math.floor(DEBUG_LIMITS.schema / scale)) };
    if (Buffer.byteLength(JSON.stringify(snapshot)) <= DEBUG_LIMITS.column) return snapshot;
    scale *= 2;
  }
}
export function debugOutput(operation: string, data: unknown) {
  if (!debugPolicy(operation).output) return undefined;
  const json = JSON.stringify(data);
  if (json === undefined) return undefined;
  let limit: number = DEBUG_LIMITS.output;
  for (;;) {
    const snapshot = { version: 1 as const, validation: "schema-valid" as const, output: debugSection(json, limit) };
    if (Buffer.byteLength(JSON.stringify(snapshot)) <= DEBUG_LIMITS.column) return snapshot;
    limit = Math.floor(limit / 2);
  }
}
const codes = ["unknown-checkpoint", "duplicate-checkpoint", "excessive-selection-count", "unknown-source-reference", "duplicate-source-reference", "limited-evidence-not-needed", "unsupported-capability", "unsupported-route", "unknown-evidence", "unavailable-evidence", "invalid-line-range", "citation-range-mismatch", "citation-excerpt-size", "validator-rejected", "unknown-claim-reference", "mismatched-document-target", "missing-document-target", "illegal-add-target", "uncertain-impact-requires-unresolved", "missing-source-support", "missing-update-intent", "duplicate-reference", "unknown-reference", "invalid-visual-claim", "unsupported-temporal-values", "invalid-contradiction", "unresolved-contradiction-assessment", "product-change-without-change-claim", "unsupported-internal-only", "invalid-reference-graph", "unknown-generation-entry", "missing-or-duplicate-generation-entry", "invalid-generation-entry", "unsupported-change-claim", "unauthorized-decision-target", "unauthorized-transformation-shape", "unauthorized-reference", "fact-claim-mismatch", "unsupported-markup", "unauthorized-generated-route", "unaddressed-claims", "invalid-section-placement", "incomplete-section-accounting"] as const;
export const validationDiagnosticSchema = z.object({ boundary: boundaryTraceSchema.optional(), kind: z.enum(["correspondence-rejection", "grounding-rejection"]),
  validator: z.enum(["visual-selection", "runtime-decision", "source-analysis", "post-validation", "documentation-planning", "product-impact", "documentation-transformation"]), code: z.enum(codes),
  path: z.string().regex(/^(?:findings\[\d{1,2}\]\.citations\[\d{1,2}\]|selected(?:\[\d{1,2}\]\.(?:checkpointId|sourceRefs\[\d{1,2}\]))?|targets\[\d{1,2}\](?:\.citations\[\d{1,2}\])?(?:\.(?:capabilityId|pathname|findingRef|targetRef))?|status|claims\.\d{1,2}\.references|decisions\[\d{1,2}\]\.(?:claimRefs|documentId|sectionId|action|updateIntent))$/).optional(),
  citation: debugSectionSchema.optional(),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), rejectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type ValidationDiagnostic = z.infer<typeof validationDiagnosticSchema>;
const validationErrors = new WeakMap<Error, Omit<ValidationDiagnostic, "kind">>();
/** Attach trusted diagnostics while preserving feature error identity and public behavior. */
export function withValidationDiagnostic<T extends Error>(error: T, diagnostic: Omit<ValidationDiagnostic, "kind">): T {
  validationErrors.set(error, diagnostic); return error;
}
export function rejectionDiagnostic(error: unknown, kind: ValidationDiagnostic["kind"]): ValidationDiagnostic {
  const knownIssue = error instanceof ModelError ? error.diagnostic?.issues?.[0]?.code : undefined;
  const attached = error instanceof Error ? validationErrors.get(error) : undefined;
  const candidate = attached ? { ...attached, kind } : knownIssue ? { kind, validator: "product-impact", code: knownIssue, ...(error instanceof ModelError && /^claims\.\d{1,2}\.references$/.test(error.diagnostic?.issues?.[0]?.path ?? "") ? { path: error.diagnostic?.issues?.[0]?.path } : {}) } : null;
  const parsed = validationDiagnosticSchema.safeParse(candidate);
  return parsed.success && debugPolicy(parsed.data.validator).diagnostic ? parsed.data : { kind, validator: "post-validation", code: "validator-rejected" };
}

export function validationMessage(code: ValidationDiagnostic["code"]) {
  const runtimeMessages: Partial<Record<ValidationDiagnostic["code"], string>> = {
    "limited-evidence-not-needed": "Limited source coverage forbids a not-needed decision.",
    "unsupported-capability": "The capability ID and exact pathname must match one supplied operator capability.",
    "unsupported-route": "The pathname and one complete citation tuple must match the same supplied route candidate.",
    "unknown-evidence": "The citation evidence ID must identify supplied evidence.",
    "unavailable-evidence": "The cited evidence must contain available text.",
    "invalid-line-range": "The citation end line must follow its start and remain within supplied evidence lines.",
    "citation-range-mismatch": "The excerpt must occur in the cited line range and span exactly that number of lines.",
    "validator-rejected": "Post-validation rejected the response; this validator supplied no approved detailed diagnostic.",
  };
  return runtimeMessages[code] ?? `Failed invariant: ${code}.`;
}
