import { z } from "zod";

// Reference/coverage correspondence only. Unsupported behavior, contradictions,
// authorization, routes, and publication failures intentionally have no entry.
export const semanticCorrectionCode = z.enum([
  "unknown-evidence", "unavailable-evidence", "invalid-line-range", "citation-range-mismatch",
  "unknown-source-reference", "duplicate-source-reference", "duplicate-reference", "unknown-reference",
  "unauthorized-reference", "unknown-claim-reference", "missing-update-intent", "invalid-reference-graph",
  "missing-or-duplicate-finding", "unknown-finding", "claim-coverage-mismatch", "all-eligible-source-findings-lost",
  "missing-or-duplicate-generation-entry", "unaddressed-claims", "fact-claim-mismatch",
]);
export const semanticCorrectionSchema = z.object({
  category: z.enum(["evidence-reference", "claim-mapping", "supported-coverage"]),
  code: semanticCorrectionCode,
  // Existing validation path vocabulary is checked before projection; no raw values.
  path: z.string().max(300).optional(),
}).strict();
export type SemanticCorrection = z.infer<typeof semanticCorrectionSchema>;
