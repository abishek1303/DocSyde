import { z } from "zod";
import { visualEvidenceSchema } from "@/integrations/ai/visual-evidence";

const pathname = z.string().min(1).max(1024).refine(value => value.startsWith("/") && !value.startsWith("//") && !/[?#\x00-\x20]/.test(value));
// Sources-owned input projection, not the local executor's implementation type.
export const runtimeVisualEvidenceSchema = z.object({
  captureId: z.uuid(), requestedPathname: pathname, finalPathname: pathname,
  capturedAt: z.iso.datetime(), screenshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
  // Optional storage identity is retained only in server-owned provenance.
  artifactKey: z.uuid().optional(),
  vision: z.object({ model: z.string().min(1).max(300), elapsedMs: z.number().finite().nonnegative(), data: visualEvidenceSchema }).strict(),
}).strict();
export type RuntimeVisualEvidence = z.infer<typeof runtimeVisualEvidenceSchema>;

export const runtimeVisualEvidenceList = z.array(runtimeVisualEvidenceSchema).max(3)
  .refine(captures => new Set(captures.map(capture => capture.captureId)).size === captures.length, "Duplicate capture identity.");

export const RUNTIME_REVISION_WARNING = "Runtime captures are not verified to correspond to the analyzed source revision; visual/source disagreements do not establish that either side is incorrect.";

export function projectVisualReferences(captures: RuntimeVisualEvidence[]) {
  return captures.flatMap(capture => (["elements", "observations"] as const).flatMap(collection =>
    capture.vision.data[collection].map((_entry, index) => ({
      id: `visual:${capture.captureId}:${collection}:${index}`, captureId: capture.captureId, collection, index,
    }))));
}
