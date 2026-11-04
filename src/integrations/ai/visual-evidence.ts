import { z } from "zod";

export const visionContextSchema = z.string().max(4000).refine(value => value.trim().length > 0);
const coordinate = z.number().finite().min(0).max(1);
const bounds = z.object({ xMin: coordinate, yMin: coordinate, xMax: coordinate, yMax: coordinate }).strict()
  .refine(box => box.xMin < box.xMax && box.yMin < box.yMax, { params: { invariant: "bounds-edges-must-increase" } });
const elementFields = {
  description: z.string().min(1).max(300),
  visibleText: z.string().max(500).nullable(),
  bounds: bounds.nullable(),
  certainty: z.enum(["clear", "uncertain"]),
};
const element = z.object(elementFields).strict()
  .refine(value => value.certainty !== "uncertain" || value.bounds === null, { params: { invariant: "uncertain-element-must-have-null-bounds" } });

export const visualEvidenceSchema = z.object({
  elements: z.array(element).max(20),
  observations: z.array(z.string().min(1).max(500)).max(10),
  limitations: z.array(z.string().min(1).max(500)).max(10),
}).strict();

// Zod refinements are not JSON Schema constraints. Encode the certainty/bounds
// dependency explicitly for Meta's strict subset (nested anyOf, never oneOf).
// Clear but unlocated elements remain valid historical evidence, not UI anchors.
const providerElement = z.union([
  z.object({ ...elementFields, certainty: z.literal("uncertain"), bounds: z.null() }).strict(),
  z.object({ ...elementFields, certainty: z.literal("clear"), bounds: z.null() }).strict(),
  z.object({ ...elementFields, certainty: z.literal("clear"), bounds }).strict(),
]);
export const visualEvidenceJsonSchema = z.toJSONSchema(visualEvidenceSchema.extend({
  elements: z.array(providerElement).max(20),
}));
// Edge ordering compares sibling values and stays authoritative in local Zod
// validation; constrained decoding does not establish ordering or visual truth.

export type VisualEvidence = z.infer<typeof visualEvidenceSchema>;
