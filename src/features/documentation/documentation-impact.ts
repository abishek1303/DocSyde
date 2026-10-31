import { z } from "zod";
import { productImpactSchema } from "@/features/sources/product-analysis";

const text = z.string().min(1).max(500).refine(value => value.trim().length > 0);
export const documentationImpactOutputSchema = z.object({
  decisions: z.array(z.object({
    action: z.enum(["revise", "add", "no-change", "unresolved"]),
    documentId: z.uuid().nullable(), sectionId: z.uuid().nullable(),
    reason: text, updateIntent: z.string().max(500),
    claimRefs: z.array(z.string().regex(/^claim-[1-6]$/)).min(1).max(6),
  }).strict()).max(8),
  uncertainties: z.array(z.string().min(1).max(300).refine(value => value.trim().length > 0)).max(6),
}).strict();

export const documentationImpactPlanSchema = documentationImpactOutputSchema.extend({
  source: productImpactSchema.shape.provenance.shape.source.pick({ repository: true, base: true, head: true }),
  claimCatalog: z.array(z.object({ id: z.string().regex(/^claim-[1-6]$/), claimIndex: z.number().int().min(0).max(5),
    claim: productImpactSchema.shape.claims.element }).strict()).max(6),
  qualifications: z.object({
    assessment: productImpactSchema.shape.assessment,
    uncertainties: productImpactSchema.shape.uncertainties,
    contradictions: productImpactSchema.shape.contradictions,
    source: productImpactSchema.shape.provenance.shape.source.pick({ limited: true, notice: true, uncertainties: true }),
  }).strict(),
}).strict();
export type DocumentationImpactPlan = z.infer<typeof documentationImpactPlanSchema>;
