import "server-only";
import { z } from "zod";
import { getDocumentationRun } from "./run-operations";
import { readMemoryInspection, readInspectionPreview } from "./run-inspection";
import { inspectionSnapshotSchema, type InspectionView } from "./run-inspection-contract";
import { loadRunInspection } from "@/integrations/database/run-inspections";
import { retainedTrace, validatedRuntimeAnalysis, screenshotForRun } from "./retained-runtime-evidence";
import { redactRuntimeText } from "@/integrations/browser/runtime-redaction";
export async function getRunInspection(rawId: unknown): Promise<InspectionView | null> {
  const run = await getDocumentationRun(z.uuid().parse(rawId));
  if (!run) return null;
  let snapshot = readMemoryInspection(run.id);
  if (!snapshot) { try { const raw = await loadRunInspection(run.id); snapshot = raw ? inspectionSnapshotSchema.parse(raw) : null; } catch { /* Canonical evidence remains readable when observations are absent. */ } }
  const trace = await retainedTrace(run);
  const parsed = await validatedRuntimeAnalysis(run, trace), selected = parsed?.selection?.selection.selected ?? [];
  const captures = trace?.checkpoints.filter(cp => cp.eligible && cp.screenshot).map(cp => ({ captureId: cp.captureId, selected: selected.some(item => item.checkpointId === cp.captureId) })) ?? [];
  const analysis = parsed?.runtime.map(evidence => ({ observations: evidence.vision.data.observations.map(text => redactRuntimeText(text)), limitations: evidence.vision.data.limitations.map(text => redactRuntimeText(text)) })) ?? [];
  const retainedReason = "schemaVersion" in run.record && run.record.runtime?.outcome === "attempted-and-failed" ? run.record.runtime.reason : null;
  const diagnostic: InspectionView["diagnostic"] = retainedReason === "selection-failed" || retainedReason === "vision-failed" || retainedReason === "cancelled" ? { code: retainedReason, source: "retained-run" as const } : undefined;
  return { ...(diagnostic ? { diagnostic } : {}), snapshot, captures, analysis, status: "schemaVersion" in run.record ? run.record.disposition ?? run.record.runtime?.outcome ?? run.record.status : run.record.status };
}
export async function getRunInspectionPreview(rawId: unknown, rawRevision: unknown) {
  const id = z.uuid().parse(rawId), revision = z.coerce.number().int().positive().parse(rawRevision);
  if (!await getDocumentationRun(id)) return { status: 404 as const, bytes: null };
  const bytes = readInspectionPreview(id, revision);
  return { status: bytes ? 200 as const : 410 as const, bytes };
}
export async function getRunInspectionScreenshot(rawId: unknown, rawCaptureId: unknown) {
  const run = await getDocumentationRun(z.uuid().parse(rawId)), captureId = z.uuid().parse(rawCaptureId);
  return run ? screenshotForRun(run, captureId) : null;
}
