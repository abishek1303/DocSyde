import type { DraftStep } from "./draft-progress";
export const RUN_STEPS: { key: DraftStep; label: string }[] = [
  { key: "prepare-context", label: "Prepare context" },
  { key: "read-evidence", label: "Read changes and evidence" },
  { key: "understand-impact", label: "Understand product impact" },
  { key: "propose-documentation", label: "Propose documentation" },
  { key: "validate-draft", label: "Validate draft" },
];
export type RunStage = { key: DraftStep; status: "waiting" | "running" | "completed" | "failed" | "skipped"; summary: string; startedAt: string | null; finishedAt: string | null };
export function initialStages(): RunStage[] { return RUN_STEPS.map(step => ({ key: step.key, status: "waiting", summary: "Waiting for preceding steps.", startedAt: null, finishedAt: null })); }
export function advanceStage(stages: RunStage[], event: { step: DraftStep; status: "running" | "completed" | "failed"; summary: string }, now: string): RunStage[] {
  const index = stages.findIndex(stage => stage.key === event.step);
  if (index < 0) throw new Error("Unknown run step.");
  const current = stages[index];
  if (event.status === "running" && (current.status !== "waiting" || stages.slice(0, index).some(stage => stage.status !== "completed"))) throw new Error("Invalid run step order.");
  if (event.status !== "running" && current.status !== "running") throw new Error("Run step is not running.");
  return stages.map((stage, i) => i !== index ? stage : { ...stage, status: event.status, summary: event.summary, startedAt: event.status === "running" ? now : stage.startedAt, finishedAt: event.status === "running" ? null : now });
}
export function finishStages(stages: RunStage[], failed: boolean, summary: string, now: string): RunStage[] {
  let failureAssigned = stages.some(stage => stage.status === "failed");
  return stages.map(stage => {
    if (["completed", "failed", "skipped"].includes(stage.status)) return stage;
    if (failed && !failureAssigned) { failureAssigned = true; return { ...stage, status: "failed", summary, finishedAt: now }; }
    return { ...stage, status: "skipped", summary: "Not required or blocked by an earlier outcome.", finishedAt: now };
  });
}
