import "server-only";
import { z } from "zod";
import type { ArtifactStorage } from "@/integrations/storage/artifact-storage";
import type { CaptureEvidence, CaptureInput } from "@/integrations/browser/capture";
import { analyzeScreenshot } from "@/integrations/ai/analyze-screenshot";
import { visionContextSchema, type VisualEvidence } from "@/integrations/ai/visual-evidence";
import { inspectionDecisionSchema, isConcreteInspectionPath, type InspectionDecision } from "@/features/sources/inspection-decision";
import { captureWithRuntime } from "./capture-runtime";

type CaptureSettings = Pick<CaptureInput, "viewport" | "outputDirectory">;
const captureSettingsSchema = z.object({
  viewport: z.object({ width: z.number().int().min(1).max(3840), height: z.number().int().min(1).max(2160) }).strict().optional(),
  outputDirectory: z.string().optional(),
}).strict();

export type InspectedTarget = {
  targetIndex: number; pathname: string; description: string;
  visibleEvidence: string[]; citations: InspectionDecision["targets"][number]["citations"];
  capture: Pick<CaptureEvidence, "captureId" | "capturedAt" | "requestedUrl" | "finalUrl" | "viewport" | "screenshot">;
  vision: { data: VisualEvidence; model: string; elapsedMs: number };
};

/** Internal local verification only. Pass result.decision directly from
 * decideRuntimeInspection(). Shape parsing cannot establish source provenance. */
export async function executeRuntimeInspection(
  { decision, runtime, capture }: {
    decision: InspectionDecision;
    runtime: Parameters<typeof captureWithRuntime>[0]["runtime"];
    capture?: CaptureSettings;
  },
  storage: ArtifactStorage,
): Promise<{ targets: InspectedTarget[] }> {
  const validated = inspectionDecisionSchema.parse(decision);
  if (validated.status !== "inspect") throw new Error("Runtime inspection execution requires an inspect decision.");
  const settings = captureSettingsSchema.parse(capture === undefined ? {} : capture);
  const targets: InspectedTarget[] = [];
  for (const [targetIndex, target] of validated.targets.entries()) {
    if (target.pathname === null || !isConcreteInspectionPath(target.pathname)) {
      throw new Error("Runtime inspection execution requires a concrete pathname.");
    }
    const context = visionContextSchema.parse([target.description, ...target.visibleEvidence].join("\n"));
    // Explicit construction prevents caller/model fields from overriding the path
    // or introducing actions, selectors or origins. The helper owns each lifecycle.
    const captured = await captureWithRuntime({ runtime, capture: {
      path: target.pathname, viewport: settings.viewport, outputDirectory: settings.outputDirectory,
    } }, storage);
    const vision = await analyzeScreenshot({ artifactKey: captured.screenshot.artifactKey, context }, storage);
    targets.push({ targetIndex, pathname: target.pathname, description: target.description,
      visibleEvidence: target.visibleEvidence, citations: target.citations,
      capture: {
        captureId: captured.captureId, capturedAt: captured.capturedAt,
        requestedUrl: captured.requestedUrl, finalUrl: captured.finalUrl,
        viewport: { width: captured.viewport.width, height: captured.viewport.height },
        screenshot: { artifactKey: captured.screenshot.artifactKey,
          sha256: captured.screenshot.sha256, mimeType: captured.screenshot.mimeType },
      },
      vision: { data: vision.data, model: vision.model, elapsedMs: vision.elapsedMs },
    });
  }
  return { targets };
}
