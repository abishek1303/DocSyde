import { z } from "zod";

export const visionContextSchema = z.string().max(4000).refine(value => value.trim().length > 0);
const coordinate = z.number().finite().min(0).max(1);
const bounds = z.object({ xMin: coordinate, yMin: coordinate, xMax: coordinate, yMax: coordinate }).strict()
  .refine(box => box.xMin < box.xMax && box.yMin < box.yMax);
const element = z.object({
  description: z.string().min(1).max(300),
  visibleText: z.string().max(500).nullable(),
  bounds: bounds.nullable(),
  certainty: z.enum(["clear", "uncertain"]),
}).strict().refine(value => value.certainty !== "uncertain" || value.bounds === null);

export const visualEvidenceSchema = z.object({
  elements: z.array(element).max(20),
  observations: z.array(z.string().min(1).max(500)).max(10),
  limitations: z.array(z.string().min(1).max(500)).max(10),
}).strict();

// Reuse the same shape in prompt text and provider constraints. Cross-field
// refinements (edge ordering and uncertainty) remain authoritative locally.
export const visualEvidenceJsonSchema = z.toJSONSchema(visualEvidenceSchema);

export type VisualEvidence = z.infer<typeof visualEvidenceSchema>;
