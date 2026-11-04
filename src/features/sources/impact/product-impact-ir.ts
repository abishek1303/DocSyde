import { z } from "zod";
import { ModelError } from "@/integrations/ai/structured-output";
import { productImpactOutputSchema, sourceCoverageSchema, type ProductImpact } from "./product-impact";

// Only judgments are authored. Temporal text is selected from pinned findings;
// citations, hashes and the full provenance graph stay server-owned.
const shortText = (max: number) => z.string().max(max).refine(value => value.trim().length > 0);
const sourceRef = z.string().regex(/^source-[1-4]$/);
const evidenceRef = z.string().min(1).max(120);
export const productImpactIRSchema = z.object({
  assessment: productImpactOutputSchema.shape.assessment,
  summary: shortText(300),
  sourceCoverage: sourceCoverageSchema.optional(),
  claims: z.array(z.object({
    // Brevity is a drafting target; retain the canonical 500-character hard limit.
    description: productImpactOutputSchema.shape.claims.element.shape.description,
    kind: productImpactOutputSchema.shape.claims.element.shape.kind,
    confidence: productImpactOutputSchema.shape.claims.element.shape.confidence,
    confidenceReason: shortText(120),
    beforeRef: sourceRef.nullable(),
    afterRef: sourceRef.nullable(),
    uncertainties: z.array(shortText(160)).max(4),
    references: z.array(evidenceRef).min(1).max(6),
  }).strict()).max(6),
  contradictions: z.array(z.object({
    description: shortText(240), status: z.literal("unresolved"),
    references: z.array(evidenceRef).min(2).max(6),
  }).strict()).max(4),
  uncertainties: z.array(shortText(160)).max(6),
}).strict();
export type ProductImpactIR = z.infer<typeof productImpactIRSchema>;

/** Exact lookup only. Unknown, unreferenced or mixed-source temporal selections fail;
 * no inference, truncation, invented prose or weakened canonical validation. */
export function resolveProductImpactClaimIR(raw: ProductImpactIR["claims"][number],
  sources: ProductImpact["provenance"]["sourceReferences"], currentState: boolean) {
  const { beforeRef, afterRef, ...claim } = raw;
  const known = new Map(sources.map(source => [source.id, source.finding]));
  const fail = (): never => {
    const error = new ModelError("grounding-rejection", undefined, { kind: "grounding-rejection", issues: [{ code: "unsupported-temporal-values", path: "claims" }] });
    error.message = "Product impact rejected: unsupported-temporal-values";
    throw error;
  };
  if (currentState && (beforeRef !== null || afterRef !== null)) fail();
  if (beforeRef !== null && afterRef !== null && beforeRef !== afterRef) fail();
  const resolve = (reference: string | null, field: "before" | "after") => {
    if (reference === null) return null;
    if (claim.kind === "visual-observation") return fail();
    const finding = known.get(reference);
    if (!finding || !claim.references.includes(reference) || finding[field] === null) return fail();
    return finding[field];
  };
  return { ...claim, before: resolve(beforeRef, "before"), after: resolve(afterRef, "after") };
}
