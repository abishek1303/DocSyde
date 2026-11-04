import { z } from "zod";
import { runtimeInspectionContextSchema } from "../runtime/runtime-inspection-context";
import { productChangeOutput } from "../analysis/product-change-analysis";
import { runtimeVisualEvidenceSchema } from "../runtime/runtime-visual-evidence";

const text = (limit: number) => z.string().max(limit).refine(value => value.trim().length > 0);
const reference = z.string().min(1).max(120);
export const sourceCoverageSchema = z.array(z.discriminatedUnion("status", [
  z.object({ findingId: z.string().regex(/^source-[1-4]$/), status: z.literal("incorporated") }).strict(),
  z.object({ findingId: z.string().regex(/^source-[1-4]$/), status: z.enum(["excluded", "uncertain"]),
    reason: z.enum(["internal-only", "unsupported", "partial-source", "contradiction"]), explanation: z.string().trim().min(1).max(180) }).strict(),
])).max(4);

export const productImpactOutputSchema = z.object({
  assessment: z.enum(["product-change", "internal-only", "insufficient-evidence"]),
  summary: text(500),
  // Optional bookkeeping, never authority for claim support or generation eligibility.
  sourceCoverage: sourceCoverageSchema.optional(),
  claims: z.array(z.object({
    description: text(500),
    kind: z.enum(["behavior-change", "workflow-change", "ui-change", "visual-observation", "internal-change"]),
    confidence: z.enum(["low", "medium", "high"]), confidenceReason: text(300),
    before: z.string().max(400).nullable(), after: z.string().max(400).nullable(),
    uncertainties: z.array(text(300)).max(4), references: z.array(reference).min(1).max(6),
  }).strict()).max(6),
  contradictions: z.array(z.object({
    description: text(500), status: z.literal("unresolved"), references: z.array(reference).min(2).max(6),
  }).strict()).max(4),
  uncertainties: z.array(text(300)).max(6),
}).strict();

export const productImpactSchema = productImpactOutputSchema.extend({
  sourceCoverageDiagnostic: z.string().max(100).optional(),
  discardedClaims: z.array(z.object({ claimIndex: z.number().int().min(0).max(5), code: z.string().max(100) }).strict()).max(6).optional(),
  provenance: z.object({
    runtimeInspection: runtimeInspectionContextSchema.optional(),
    source: z.object({ repository: z.string().max(2048), base: z.string().length(40), head: z.string().length(40),
      limited: z.boolean(), notice: z.string().max(2000), uncertainties: z.array(z.string().max(300)).max(4) }).strict(),
    sourceReferences: z.array(z.object({ id: reference, findingIndex: z.number().int().nonnegative(),
      finding: productChangeOutput.shape.findings.element }).strict()).max(4),
    sourceEvidence: z.array(z.object({ id: z.string().max(30), path: z.string().max(1024), side: z.enum(["patch", "base", "head"]),
      commitId: z.string().regex(/^[a-f0-9]{40}$/i).nullable(), contentId: z.string().max(200).nullable() }).strict()).max(50),
    captures: z.array(runtimeVisualEvidenceSchema.omit({ vision: true }).extend({
      vision: runtimeVisualEvidenceSchema.shape.vision.omit({ data: true }),
    })).max(3),
    visualReferences: z.array(z.object({ id: reference, captureId: z.uuid(),
      collection: z.enum(["elements", "observations"]), index: z.number().int().nonnegative() }).strict()).max(90),
  }).strict(),
}).strict();
export type ProductImpact = z.infer<typeof productImpactSchema>;
