import "server-only";
import { randomUUID } from "node:crypto";
import { admitDocumentationRun, findDocumentationRun, mutateDocumentationRun } from "@/integrations/database/documentation-runs";
import { getDocumentationRun } from "./run-operations";
import { runRecordV2 } from "./run-record";
import { finishRun, ownedRun, reconcileDocumentationRuns, RunOwnershipLost, writeRunCheckpoint } from "./run-checkpoints";
import { RUN_CONTROL_MS, RUN_DEADLINE_MS, RUN_HEARTBEAT_FAILURE_MS, RUN_HEARTBEAT_MS, RUN_RECONCILE_MS } from "./run-workflow-state";
import { CandidateSelectionIncompleteError } from "./select-documentation-candidates";
import { executeRunWorkflow, RunStageError } from "./execute-run-workflow";

type ActiveRun = {
  id: string; token: string; controller: AbortController; task: Promise<void>;
  heartbeatTimer?: ReturnType<typeof setInterval>; controlTimer?: ReturnType<typeof setInterval>;
  lastHeartbeat: number; heartbeatBusy: boolean; controlBusy: boolean; heartbeatTask?: Promise<unknown>; controlTask?: Promise<unknown>;
};
type Coordinator = { active?: ActiveRun; initialization?: Promise<void>; maintenanceTimer?: ReturnType<typeof setInterval>; reconciling: boolean };
const processState = globalThis as typeof globalThis & { docsydeRunCoordinator?: Coordinator };
function state() { return processState.docsydeRunCoordinator ??= { reconciling: false }; }
export class RunBusyError extends Error {}

export async function initializeRunCoordinator() {
  const coordinator = state();
  if (!coordinator.initialization) {
    coordinator.initialization = reconcileDocumentationRuns(coordinator.active).then(() => {
      coordinator.maintenanceTimer = setInterval(() => {
        if (coordinator.reconciling) return;
        coordinator.reconciling = true;
        void reconcileDocumentationRuns(coordinator.active).catch(() => { /* A later sweep retries; never infer success on DB failure. */ }).finally(() => { coordinator.reconciling = false; });
      }, RUN_RECONCILE_MS);
      coordinator.maintenanceTimer.unref();
    }).catch(error => { coordinator.initialization = undefined; throw error; });
  }
  await coordinator.initialization;
}

async function control(active: ActiveRun) {
  if (Date.now() - active.lastHeartbeat >= RUN_HEARTBEAT_FAILURE_MS) active.controller.abort("heartbeat-renewal-failed");
  active.controller.signal.throwIfAborted();
  const row = await findDocumentationRun(active.id);
  if (!row) throw new RunOwnershipLost();
  const record = ownedRun(row, active.token);
  if (record.execution?.cancelRequestedAt) active.controller.abort("user-cancelled");
  active.controller.signal.throwIfAborted();
}

/** Same-process task ownership is deliberate: no request signal, after(), queue or durable resume. */
export async function startDocumentationRun(rawId: unknown) {
  const run = await getDocumentationRun(rawId);
  if (!run) throw new Error("Run not found.");
  const coordinator = state();
  if (run.record.status !== "pending") return { id: run.id, accepted: false };
  if (coordinator.active) {
    if (coordinator.active.id === run.id) return { id: run.id, accepted: true };
    throw new RunBusyError("Another run is active.");
  }
  if (!("schemaVersion" in run.record)) throw new Error("Create a new attempt for a legacy pending run.");
  const active: ActiveRun = { id: run.id, token: randomUUID(), controller: new AbortController(), task: Promise.resolve(), lastHeartbeat: Date.now(), heartbeatBusy: false, controlBusy: false };
  // Reserve before any admission await; simultaneous starts cannot both reserve this process.
  coordinator.active = active;
  try {
    await reconcileDocumentationRuns(active);
    const admission = await admitDocumentationRun(run.id, `https://github.com/${run.record.input.owner.toLowerCase()}/${run.record.input.repo.toLowerCase()}`, row => {
      const pending = runRecordV2.parse(row.payload), now = new Date().toISOString();
      if (pending.status !== "pending") return null;
      return { status: "running", payload: runRecordV2.parse({ ...pending, status: "running", startedAt: now, summary: "Run in progress.", execution: { token: active.token, heartbeatAt: now, cancelRequestedAt: null } }) };
    });
    if (admission !== "claimed") {
      coordinator.active = undefined;
      if (admission === "busy") throw new RunBusyError("A persisted run is still running; wait for completion or interruption reconciliation.");
      return { id: run.id, accepted: false };
    }
    active.lastHeartbeat = Date.now();
    active.heartbeatTimer = setInterval(() => {
      if (active.heartbeatBusy || active.controller.signal.aborted) return;
      active.heartbeatBusy = true;
      active.heartbeatTask = writeRunCheckpoint(active.id, active.token, r => ({ ...r, execution: { ...r.execution!, heartbeatAt: new Date().toISOString() } }), true)
        .then(() => { active.lastHeartbeat = Date.now(); })
        .catch(error => { if (error instanceof RunOwnershipLost) active.controller.abort("ownership-lost"); })
        .finally(() => { active.heartbeatBusy = false; });
    }, RUN_HEARTBEAT_MS);
    active.controlTimer = setInterval(() => {
      if (Date.now() - active.lastHeartbeat >= RUN_HEARTBEAT_FAILURE_MS) active.controller.abort("heartbeat-renewal-failed");
      if (active.controlBusy || active.controller.signal.aborted) return;
      active.controlBusy = true;
      active.controlTask = control(active).catch(error => { if (error instanceof RunOwnershipLost) active.controller.abort("ownership-lost"); })
        .finally(() => { active.controlBusy = false; });
    }, RUN_CONTROL_MS);
    const deadline = setTimeout(() => active.controller.abort("application-deadline"), RUN_DEADLINE_MS);
    // The promise is retained and all rejection handling is installed before returning acceptance.
    active.task = executeRunWorkflow(active.id, active.token, active.controller.signal, () => control(active)).catch(async error => {
      if (error instanceof RunOwnershipLost) return;
      try {
        await writeRunCheckpoint(active.id, active.token, r => {
          const cancelled = Boolean(r.execution?.cancelRequestedAt);
          const selectionIncomplete = error instanceof RunStageError && error.cause instanceof CandidateSelectionIncompleteError;
          const reason = cancelled ? "user-cancelled" : selectionIncomplete ? "documentation-candidates-incomplete" : active.controller.signal.aborted ? String(active.controller.signal.reason) : `stage-failed:${error instanceof RunStageError ? error.stage : r.activeStage ?? "execution"}`;
          return finishRun(error instanceof RunStageError ? { ...r, activeStage: error.stage } : r, cancelled ? "cancelled" : selectionIncomplete ? "incomplete" : "failed", reason);
        }, true);
      } catch { /* Lost ownership/DB failure: preserved checkpoints are reconciled after heartbeat expiry. */ }
    }).finally(async () => {
      clearTimeout(deadline); clearInterval(active.heartbeatTimer); clearInterval(active.controlTimer);
      await Promise.allSettled([active.heartbeatTask, active.controlTask]);
      if (coordinator.active?.token === active.token) coordinator.active = undefined;
    });
    return { id: run.id, accepted: true };
  } catch (error) {
    if (coordinator.active?.token === active.token) coordinator.active = undefined;
    throw error;
  }
}

export async function cancelDocumentationRun(rawId: unknown) {
  const run = await getDocumentationRun(rawId);
  if (!run) throw new Error("Run not found.");
  if (!("schemaVersion" in run.record)) throw new Error("Legacy run cannot be cancelled; create a new attempt.");
  await mutateDocumentationRun(run.id, row => {
    const r = runRecordV2.parse(row.payload);
    if (r.status === "finished") return null;
    if (r.status === "pending") return { status: "finished", payload: finishRun(r, "cancelled", "user-cancelled-before-start") };
    return { status: r.status, payload: { ...r, execution: { ...r.execution!, cancelRequestedAt: r.execution!.cancelRequestedAt ?? new Date().toISOString() } } };
  });
  const active = state().active;
  if (active?.id === run.id) active.controller.abort("user-cancelled");
  return { id: run.id };
}

// Explicit lifecycle hook for local verification/shutdown; waits for Runner cleanup before release.
export async function stopRunCoordinator() {
  const coordinator = state();
  clearInterval(coordinator.maintenanceTimer);
  if (coordinator.active) { coordinator.active.controller.abort("coordinator-stopped"); await coordinator.active.task; }
  coordinator.initialization = undefined;
}
