import "server-only";

import { launchRuntime, attachRuntime } from "@/runner/runtime/runtime";
import { captureRuntimeContext, type CaptureInput, type CaptureEvidence } from "@/integrations/browser/capture";
import type { ArtifactStorage } from "@/integrations/storage/artifact-storage";

type Runtime =
  | { mode: "launch"; options: Parameters<typeof launchRuntime>[0] }
  | { mode: "attach"; options: Parameters<typeof attachRuntime>[0] };

export async function captureWithRuntime(
  { runtime, capture }: { runtime: Runtime; capture: Omit<CaptureInput, "baseUrl"> },
  storage: ArtifactStorage,
): Promise<CaptureEvidence> {
  const session = runtime.mode === "launch"
    ? await launchRuntime(runtime.options)
    : await attachRuntime(runtime.options);

  let evidence: CaptureEvidence;
  try {
    evidence = await captureRuntimeContext({ ...capture, baseUrl: session.description.baseUrl }, storage);
  } catch (captureError) {
    try {
      await session.stop();
    } catch (stopError) {
      throw new AggregateError([captureError, stopError], "Capture and runtime cleanup both failed.");
    }
    throw captureError;
  }
  await session.stop();
  return evidence;
}
