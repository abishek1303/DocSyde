import { z } from "zod";

export const RUN_HEARTBEAT_MS = 10_000;
export const RUN_CONTROL_MS = 2_000;
export const RUN_STALE_MS = 60_000;
export const RUN_HEARTBEAT_FAILURE_MS = 30_000;
export const RUN_RECONCILE_MS = 15_000;
export const RUN_DEADLINE_MS = 40 * 60_000;
export const WORKFLOW_STEPS = ["prepare-context", "source-analysis", "runtime-decision", "runtime-inspection", "impact-synthesis", "documentation-planning", "documentation-transformation", "proposal-retention"] as const;
export const runDisposition = z.enum(["awaiting-review", "no-change", "incomplete", "failed", "cancelled", "interrupted"]);
export const workflowStage = z.object({
  key: z.enum(WORKFLOW_STEPS), status: z.enum(["waiting", "running", "completed", "skipped", "incomplete", "failed", "cancelled"]),
  summary: z.string().max(2000), startedAt: z.iso.datetime().nullable(), finishedAt: z.iso.datetime().nullable(),
  batchProgress: z.object({ processed: z.number().int().min(0).max(8), total: z.number().int().min(0).max(8), active: z.number().int().min(1).max(8).nullable(), acceptedDecisions: z.number().int().min(0).max(8) }).strict().refine(value => value.processed <= value.total && (value.active === null || (value.active <= value.total && value.active > value.processed))).optional(),
  model: z.string().max(300).optional(), elapsedMs: z.number().nonnegative().optional(),
});
export type WorkflowStage = z.infer<typeof workflowStage>;
export type RunDisposition = z.infer<typeof runDisposition>;
export function initialWorkflowStages(): WorkflowStage[] {
  return WORKFLOW_STEPS.map(key => ({ key, status: "waiting", summary: "Waiting for preceding stages.", startedAt: null, finishedAt: null }));
}
export function changeWorkflowStage(stages: WorkflowStage[], key: WorkflowStage["key"], status: WorkflowStage["status"], summary: string, now = new Date().toISOString()): WorkflowStage[] {
  const index = stages.findIndex(s => s.key === key), current = stages[index];
  if (!current || (status === "running" && (current.status !== "waiting" || stages.slice(0, index).some(s => !["completed", "skipped"].includes(s.status))))
    || (status === "completed" && current.status !== "running") || (status === "skipped" && current.status !== "waiting")) throw new Error("Invalid workflow stage transition.");
  return stages.map(s => s.key !== key ? s : { ...s, status, summary, startedAt: status === "running" ? now : s.startedAt, finishedAt: status === "running" ? null : now });
}
