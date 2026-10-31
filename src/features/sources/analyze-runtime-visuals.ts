import "server-only";
import type { ArtifactStorage } from "@/integrations/storage/artifact-storage";
import type { RuntimeTrace } from "@/integrations/browser/runtime-trace";
import { redactRuntimeText, runtimePath } from "@/integrations/browser/runtime-redaction";
import { analyzeScreenshot } from "@/integrations/ai/analyze-screenshot";
import type { ProductResult } from "./product-change-analysis";
import { summarizeRuntimeStates, type RuntimeStateSummary } from "./runtime-state-summary";
import { selectVisualCheckpoints } from "./select-visual-checkpoints";
import { selectedScreenshotLimit, DEFAULT_SELECTED_SCREENSHOTS } from "./visual-selection";
import { runtimeVisualEvidenceList, type RuntimeVisualEvidence } from "./runtime-visual-evidence";

type SelectionResult = Awaited<ReturnType<typeof selectVisualCheckpoints>>;
export type RuntimeVisualAnalysis = {
  status: "complete" | "skipped" | "disabled" | "incomplete";
  reason: "analyzed" | "model-skip" | "disabled" | "no-eligible-checkpoints" | "invalid-input" | "selection-failed" | "vision-failed" | "cancelled";
  summary?: RuntimeStateSummary; selection?: SelectionResult;
  runtime: RuntimeVisualEvidence[];
  // Relevance links only. These never become source references in ProductImpact.
  provenance: { captureId: string; stateId: string; sourceRefs: string[] }[];
};

/** Trusted server entry. Pass direct source analysis and completed capture output,
 * never client-supplied JSON as an authenticated evidence claim. */
export async function analyzeRuntimeVisuals(
  { source, trace, description, maxSelectedScreenshots = DEFAULT_SELECTED_SCREENSHOTS, secrets = [] }: {
    source: ProductResult; trace: RuntimeTrace; description: string; maxSelectedScreenshots?: number; secrets?: readonly string[];
  }, storage: ArtifactStorage, signal?: AbortSignal,
): Promise<RuntimeVisualAnalysis> {
  const result: RuntimeVisualAnalysis = { status: "incomplete", reason: "invalid-input", runtime: [], provenance: [] };
  let phase: "invalid-input" | "selection-failed" | "vision-failed" = "invalid-input";
  try {
    selectedScreenshotLimit.parse(maxSelectedScreenshots);
    signal?.throwIfAborted();
    const summarized = summarizeRuntimeStates(source, trace, description, secrets);
    result.summary = summarized.input;
    if (maxSelectedScreenshots === 0) return { ...result, status: "disabled", reason: "disabled" };
    if (!summarized.input.candidates.length) return { ...result, reason: "no-eligible-checkpoints" };
    phase = "selection-failed";
    const selected = await selectVisualCheckpoints(summarized.input, maxSelectedScreenshots, signal);
    result.selection = selected;
    if (selected.selection.decision === "skip") return { ...result, status: "skipped", reason: "model-skip" };
    phase = "vision-failed";
    for (const item of selected.selection.selected) {
      signal?.throwIfAborted();
      const checkpoint = summarized.trace.checkpoints.find(cp => cp.captureId === item.checkpointId)!;
      const state = summarized.trace.states.find(state => state.stateId === checkpoint.stateId)!;
      const screenshot = checkpoint.screenshot!;
      // JSON remains DATA inside the fixed vision prompt. Never promote generated
      // questions/reasons to developer instructions or send raw runtime text.
      const context = JSON.stringify({ task: "Describe only current visible evidence relevant to these findings.",
        imageCoverage: checkpoint.crop ? "Cropped UI region; surrounding page is unobserved." : "Viewport only; offscreen content is unobserved.",
        findings: summarized.input.findings.filter(finding => item.sourceRefs.includes(finding.id)).map(finding => ({
          id: finding.id, description: finding.description.slice(0, 300),
        })), question: redactRuntimeText(item.question, secrets, 300) });
      const vision = await analyzeScreenshot({ artifactKey: screenshot.artifactKey, expectedSha256: screenshot.sha256, context, signal }, storage);
      signal?.throwIfAborted();
      const evidence = runtimeVisualEvidenceList.parse([...result.runtime, {
        captureId: checkpoint.captureId, capturedAt: checkpoint.capturedAt, artifactKey: screenshot.artifactKey,
        requestedPathname: runtimePath(summarized.trace.requestedPathname, secrets), finalPathname: runtimePath(state.snapshot.pathname, secrets),
        screenshotSha256: screenshot.sha256, vision,
      }]);
      result.runtime = evidence;
      result.provenance.push({ captureId: checkpoint.captureId, stateId: checkpoint.stateId, sourceRefs: [...item.sourceRefs] });
    }
    return { ...result, status: "complete", reason: "analyzed" };
  } catch {
    // Retain explicit partial evidence for inspection, never report it as complete.
    return { ...result, status: "incomplete", reason: signal?.aborted ? "cancelled" : phase };
  }
}
