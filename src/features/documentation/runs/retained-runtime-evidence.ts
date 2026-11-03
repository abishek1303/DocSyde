import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { readStoredDocumentationRun } from "./read-run-record";
import { getArtifactStorage } from "@/integrations/storage/storage";
import { runtimeTraceSchema, type RuntimeTrace } from "@/integrations/browser/runtime-trace";
import { runtimeVisualEvidenceList, visualSelectionSchema } from "@/features/sources/response-evidence";
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const manifestSchema = z.object({ trace: runtimeTraceSchema });
const analysisSchema = z.object({ runtime: runtimeVisualEvidenceList, selection: z.object({ selection: visualSelectionSchema }).optional() });
export type EvidenceRun = NonNullable<Awaited<ReturnType<typeof readStoredDocumentationRun>>>;
type Run = EvidenceRun;
async function manifest(run: Run, kind: "runtime-trace" | "runtime-analysis") {
  if (!("schemaVersion" in run.record)) return null;
  const ref = run.record.artifacts.find(a => a.kind === kind);
  if (!ref) return null;
  const bytes = await getArtifactStorage().read(ref.key);
  if (!bytes || bytes.byteLength > 2 * 1024 * 1024 || sha(bytes) !== ref.sha256) throw new Error("Manifest integrity failure");
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
}
export async function retainedTrace(run: Run) {
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
export async function validatedRuntimeAnalysis(run: Run, trace: RuntimeTrace | null) {
  const raw = await manifest(run, "runtime-analysis");
  if (!raw) return null;
  const parsed = analysisSchema.parse(raw), selected = parsed.selection?.selection.selected ?? [];
  const captures = trace?.checkpoints.filter(cp => cp.eligible && cp.screenshot) ?? [];
  if (new Set(selected.map(item => item.checkpointId)).size !== selected.length || selected.some(item => !captures.some(cp => cp.captureId === item.checkpointId))) throw new Error("Selection membership failure");
  for (const evidence of parsed.runtime) {
    const cp = captures.find(cp => cp.captureId === evidence.captureId);
    if (!cp?.screenshot || cp.screenshot.sha256 !== evidence.screenshotSha256 || cp.screenshot.artifactKey !== evidence.artifactKey || !selected.some(item => item.checkpointId === cp.captureId)) throw new Error("Vision membership failure");
  }
  return parsed;
}
export async function screenshotForRun(run: Run, captureId: string) {
  const trace = await retainedTrace(run), cp = trace?.checkpoints.find(cp => cp.captureId === captureId);
  if (!cp?.eligible || !cp.screenshot) return null;
  const bytes = await getArtifactStorage().read(cp.screenshot.artifactKey);
  if (!bytes || bytes.byteLength > 10 * 1024 * 1024 || sha(bytes) !== cp.screenshot.sha256 || Buffer.from(bytes).subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Image integrity failure");
  return bytes;
}

export async function getDocumentableRunCaptures(rawId: unknown) {
  const run = await readStoredDocumentationRun(z.uuid().parse(rawId));
  if (!run || !("schemaVersion" in run.record) || run.record.runtime?.outcome !== "completed") return null;
  const trace = await retainedTrace(run);
  if (!trace) return null;
  const analysis = await validatedRuntimeAnalysis(run, trace);
  if (!analysis) return null;
  const captures = [];
  for (const evidence of analysis.runtime) {
    const cp = trace.checkpoints.find(cp => cp.captureId === evidence.captureId);
    const state = trace.states.find(state => state.stateId === cp?.stateId);
    if (!cp?.eligible || cp.limitation || !cp.screenshot || state?.snapshot.pathname !== evidence.finalPathname || evidence.capturedAt !== cp.capturedAt) continue;
    const bytes = await screenshotForRun(run, cp.captureId);
    if (!bytes || bytes.length < 24) continue;
    captures.push({ evidence, sourceRefs: analysis.selection?.selection.selected.find(selected => selected.checkpointId === cp.captureId)?.sourceRefs ?? [], width: Buffer.from(bytes).readUInt32BE(16), height: Buffer.from(bytes).readUInt32BE(20) });
  }
  return { run, captures };
}
