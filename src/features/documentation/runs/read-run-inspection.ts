import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getDocumentationRun } from "./run-operations";
import { readMemoryInspection, readInspectionPreview } from "./run-inspection";
import { inspectionSnapshotSchema, type InspectionView } from "./run-inspection-contract";
import { loadRunInspection } from "@/integrations/database/run-inspections";
import { getArtifactStorage } from "@/integrations/storage/storage";
import { runtimeTraceSchema } from "@/integrations/browser/runtime-trace";
import { runtimeVisualEvidenceList, visualSelectionSchema } from "@/features/sources/response-evidence";
import { redactRuntimeText } from "@/integrations/browser/runtime-redaction";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const manifestSchema = z.object({ trace: runtimeTraceSchema });
const analysisSchema = z.object({ runtime: runtimeVisualEvidenceList, selection: z.object({ selection: visualSelectionSchema }).optional() });
type Run = NonNullable<Awaited<ReturnType<typeof getDocumentationRun>>>;
async function manifest(run: Run, kind: "runtime-trace" | "runtime-analysis") {
  if (!("schemaVersion" in run.record)) return null;
  const ref = run.record.artifacts.find(a => a.kind === kind);
  if (!ref) return null;
  const bytes = await getArtifactStorage().read(ref.key);
  if (!bytes || bytes.byteLength > 2 * 1024 * 1024 || sha(bytes) !== ref.sha256) throw new Error("Manifest integrity failure");
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
}
async function retainedTrace(run: Run) {
  const raw = await manifest(run, "runtime-trace");
  if (!raw) return null;
  const { trace } = manifestSchema.parse(raw);
  if (new Set(trace.states.map(s => s.stateId)).size !== trace.states.length || new Set(trace.checkpoints.map(cp => cp.captureId)).size !== trace.checkpoints.length) throw new Error("Duplicate trace identity");
  // Capture hashes the sampled projection before schema parsing reorders keys.
  // Reconstruct that existing serialization; never alter canonical fingerprints.
  for (const state of trace.states) {
    const s = state.snapshot;
    const capturedProjection = { headings: s.headings, text: s.text, regions: s.regions, controls: s.controls, overlays: s.overlays, truncated: s.truncated, pathname: s.pathname, hostContext: s.hostContext };
    if (sha(Buffer.from(JSON.stringify(capturedProjection))) !== state.fingerprint) throw new Error("State integrity failure");
  }
  for (const cp of trace.checkpoints) if (!trace.states.some(s => s.stateId === cp.stateId) || (cp.eligible && (!cp.screenshot || cp.limitation))) throw new Error("Checkpoint integrity failure");
  return trace;
}
export async function getRunInspection(rawId: unknown): Promise<InspectionView | null> {
  const run = await getDocumentationRun(z.uuid().parse(rawId));
  if (!run) return null;
  let snapshot = readMemoryInspection(run.id);
  if (!snapshot) { try { const raw = await loadRunInspection(run.id); snapshot = raw ? inspectionSnapshotSchema.parse(raw) : null; } catch { /* Canonical evidence remains readable when observations are absent. */ } }
  const trace = await retainedTrace(run);
  const captures = trace?.checkpoints.filter(cp => cp.eligible && cp.screenshot).map(cp => ({ captureId: cp.captureId, selected: false })) ?? [];
  const raw = await manifest(run, "runtime-analysis");
  const analysis: InspectionView["analysis"] = [];
  if (raw) {
    const parsed = analysisSchema.parse(raw);
    const selected = parsed.selection?.selection.selected ?? [];
    if (new Set(selected.map(s => s.checkpointId)).size !== selected.length || selected.some(s => !captures.some(cp => cp.captureId === s.checkpointId))) throw new Error("Selection membership failure");
    for (const cp of captures) cp.selected = selected.some(s => s.checkpointId === cp.captureId);
    for (const evidence of parsed.runtime) {
      const cp = trace?.checkpoints.find(cp => cp.captureId === evidence.captureId);
      if (!cp?.eligible || !cp.screenshot || cp.screenshot.sha256 !== evidence.screenshotSha256 || cp.screenshot.artifactKey !== evidence.artifactKey || !selected.some(s => s.checkpointId === cp.captureId)) throw new Error("Vision membership failure");
      analysis.push({ observations: evidence.vision.data.observations.map(text => redactRuntimeText(text)), limitations: evidence.vision.data.limitations.map(text => redactRuntimeText(text)) });
    }
  }
  return { snapshot, captures, analysis, status: "schemaVersion" in run.record ? run.record.disposition ?? run.record.runtime?.outcome ?? run.record.status : run.record.status };
}
export async function getRunInspectionPreview(rawId: unknown, rawRevision: unknown) {
  const id = z.uuid().parse(rawId), revision = z.coerce.number().int().positive().parse(rawRevision);
  if (!await getDocumentationRun(id)) return { status: 404 as const, bytes: null };
  const bytes = readInspectionPreview(id, revision);
  return { status: bytes ? 200 as const : 410 as const, bytes };
}
export async function getRunInspectionScreenshot(rawId: unknown, rawCaptureId: unknown) {
  const run = await getDocumentationRun(z.uuid().parse(rawId)), captureId = z.uuid().parse(rawCaptureId);
  if (!run) return null;
  const trace = await retainedTrace(run), cp = trace?.checkpoints.find(cp => cp.captureId === captureId);
  if (!cp?.eligible || !cp.screenshot) return null;
  const bytes = await getArtifactStorage().read(cp.screenshot.artifactKey);
  if (!bytes || bytes.byteLength > 10 * 1024 * 1024 || sha(bytes) !== cp.screenshot.sha256 || Buffer.from(bytes).subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Image integrity failure");
  return bytes;
}
