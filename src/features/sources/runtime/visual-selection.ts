import { reliabilityBudget } from "@/integrations/ai/demo-reliability";
import { z } from "zod";

export const MAX_SELECTED_SCREENSHOTS = 3;
export const DEFAULT_SELECTED_SCREENSHOTS = 3;
export const SELECTION_REQUEST_BYTES = 32 * 1024;
export const SELECTION_OUTPUT_TOKENS = 3072;
export const selectedScreenshotLimit = z.number().int().min(0).max(MAX_SELECTED_SCREENSHOTS);
const reason = z.string().min(1).max(400).refine(value => value.trim().length > 0);
export const legacyVisualSelectionSchema = z.object({
  decision: z.enum(["analyze", "skip"]), reason,
  selected: z.array(z.object({
    checkpointId: z.uuid(), sourceRefs: z.array(z.string().regex(/^source-[1-4]$/)).max(4), reason,
    question: z.string().min(1).max(300),
  }).strict()).max(MAX_SELECTED_SCREENSHOTS),
  uncertainties: z.array(z.string().min(1).max(300)).max(4),
}).strict();

const compactSelectionItem = z.object({
  checkpointId: z.uuid(),
  sourceRefs: z.array(z.string().regex(/^source-[1-4]$/)).max(4),
  question: z.string().min(1).max(80).refine(value => value.trim().length > 0),
}).strict();
/** Only this compact object is requested from the model. The actual budget is visible in its schema. */
export function visualSelectionOutputSchema(limit: number) {
  return z.object({ selected: z.array(compactSelectionItem).max(selectedScreenshotLimit.parse(limit)) }).strict();
}
export type VisualSelectionOutput = z.infer<ReturnType<typeof visualSelectionOutputSchema>>;
// Version is server-owned envelope metadata, never an additional model output field.
export const visualSelectionV3Schema = z.object({ version: z.literal(3), selected: z.array(compactSelectionItem).max(MAX_SELECTED_SCREENSHOTS) }).strict();
export const visualSelectionSchema = z.union([legacyVisualSelectionSchema, visualSelectionV3Schema]);
export type VisualSelection = z.infer<typeof visualSelectionSchema>;

export function selectionRequestBytes() { return reliabilityBudget(SELECTION_REQUEST_BYTES, 96 * 1024); }
