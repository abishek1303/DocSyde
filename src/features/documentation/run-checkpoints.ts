import "server-only";
import { mutateDocumentationRun, runningDocumentationRuns, type DocumentationRunRow } from "@/integrations/database/documentation-runs";
import { runRecord, runRecordV2, type RunRecordV2 } from "./run-record";
import { RUN_STALE_MS, type RunDisposition } from "./run-workflow-state";

import { runFailureDescription, type RunFailure } from "./run-failure";

export class RunOwnershipLost extends Error {}
export function ownedRun(row: DocumentationRunRow, token: string): RunRecordV2 {
  const r = runRecordV2.parse(row.payload);
  if (row.status !== "running" || r.status !== "running" || r.execution?.token !== token) throw new RunOwnershipLost("Run ownership lost.");
  return r;
}
export function finishRun(record: RunRecordV2, disposition: RunDisposition, reason: string, failure?: RunFailure): RunRecordV2 {
  const now = new Date().toISOString();
  const summary = failure ? runFailureDescription(failure.code).message : reason;
  return runRecordV2.parse({ ...record, ...(failure ? { failure } : {}), status: "finished", disposition, reason, summary, activeStage: null, finishedAt: now,
    stages: record.stages.map(s => s.status === "running" || (disposition === "failed" && s.key === record.activeStage) ? { ...s, status: disposition === "cancelled" ? "cancelled" : disposition === "failed" || disposition === "interrupted" ? "failed" : "incomplete", summary, finishedAt: now }
      : s.status === "waiting" ? { ...s, status: "skipped", summary: failure ? "Not run because an earlier stage stopped." : `Not executed: ${reason}`, finishedAt: now } : s),
  });
}
export async function writeRunCheckpoint(id: string, token: string, change: (record: RunRecordV2) => RunRecordV2, allowCancellation = false) {
  const result = await mutateDocumentationRun(id, row => {
    const record = ownedRun(row, token);
    if (!allowCancellation && record.execution?.cancelRequestedAt) throw new Error("Run cancellation requested.");
    const next = runRecordV2.parse(change(record));
    return { status: next.status, payload: next };
  });
  return runRecordV2.parse(result.payload);
}
export async function reconcileDocumentationRuns(local?: { id: string; token: string }, now = Date.now()) {
  const rows = await runningDocumentationRuns();
  for (const observed of rows) {
    const parsed = runRecord.safeParse(observed.payload);
    if (!parsed.success) continue;
    const record = parsed.data;
    const v2 = "schemaVersion" in record;
    const heartbeat = v2 ? record.execution?.heartbeatAt : observed.updatedAt.toISOString();
    if (!heartbeat || now - Date.parse(heartbeat) < RUN_STALE_MS || (v2 && local?.id === observed.id && local.token === record.execution?.token)) continue;
    await mutateDocumentationRun(observed.id, row => {
      if (row.status !== "running" || row.updatedAt.getTime() !== observed.updatedAt.getTime()) return null;
      if (v2) {
        const current = runRecordV2.parse(row.payload);
        if (current.execution?.token !== record.execution?.token || current.execution?.heartbeatAt !== heartbeat) return null;
        const next = finishRun(current, "interrupted", "Execution heartbeat expired; start an explicit new attempt.");
        return { status: next.status, payload: next };
      }
      return { status: "interrupted", payload: { ...record, status: "interrupted", finishedAt: new Date(now).toISOString(), summary: "Legacy request execution interrupted; start a new attempt." } };
    });
  }
}
