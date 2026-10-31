import { z } from "zod";

export const MAX_SELECTED_SCREENSHOTS = 3;
export const DEFAULT_SELECTED_SCREENSHOTS = 3;
export const SELECTION_REQUEST_BYTES = 32 * 1024;
export const SELECTION_OUTPUT_TOKENS = 2048;
export const selectedScreenshotLimit = z.number().int().min(0).max(MAX_SELECTED_SCREENSHOTS);
const reason = z.string().min(1).max(400).refine(value => value.trim().length > 0);
export const visualSelectionSchema = z.object({
  decision: z.enum(["analyze", "skip"]), reason,
  selected: z.array(z.object({
    checkpointId: z.uuid(), sourceRefs: z.array(z.string().regex(/^source-[1-4]$/)).max(4), reason,
    question: z.string().min(1).max(300),
  }).strict()).max(MAX_SELECTED_SCREENSHOTS),
  uncertainties: z.array(z.string().min(1).max(300)).max(4),
}).strict();
export type VisualSelection = z.infer<typeof visualSelectionSchema>;
