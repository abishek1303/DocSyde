import "server-only";
import type { ArtifactStorage } from "@/integrations/storage/artifact-storage";
import { generateStructuredVision } from "@/integrations/ai/generate-structured-vision";
import { ModelError } from "@/integrations/ai/structured-output";
import { visionContextSchema, type VisualEvidence } from "@/integrations/ai/visual-evidence";

export async function analyzeScreenshot(
  { artifactKey, context, signal }: { artifactKey: string; context: string; signal?: AbortSignal },
  storage: ArtifactStorage,
): Promise<{ data: VisualEvidence; model: string; elapsedMs: number }> {
  if (!visionContextSchema.safeParse(context).success) throw new ModelError("invalid-input");
  if (signal?.aborted) throw new ModelError("cancelled");
  const png = await storage.read(artifactKey);
  if (png === null) throw new ModelError("artifact-not-found");
  return generateStructuredVision({ png, context, signal });
}
