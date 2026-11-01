import "server-only";
import type { InvocationContext } from "./invocation-context";
import { createHash } from "node:crypto";
import type { ArtifactStorage } from "@/integrations/storage/artifact-storage";
import { generateStructuredVision } from "@/integrations/ai/generate-structured-vision";
import { ModelError } from "@/integrations/ai/structured-output";
import { visionContextSchema, type VisualEvidence } from "@/integrations/ai/visual-evidence";

export async function analyzeScreenshot(
  { artifactKey, context, signal, expectedSha256, invocation }: { invocation?: InvocationContext; artifactKey: string; context: string; signal?: AbortSignal; expectedSha256?: string },
  storage: ArtifactStorage,
): Promise<{ data: VisualEvidence; model: string; elapsedMs: number }> {
  if (!visionContextSchema.safeParse(context).success) throw new ModelError("invalid-input");
  if (signal?.aborted) throw new ModelError("cancelled");
  const png = await storage.read(artifactKey);
  if (png === null) throw new ModelError("artifact-not-found");
  if (expectedSha256 !== undefined && (!/^[a-f0-9]{64}$/.test(expectedSha256)
    || createHash("sha256").update(png).digest("hex") !== expectedSha256)) throw new ModelError("artifact-hash-mismatch");
  return generateStructuredVision({ png, context, signal, invocation });
}
