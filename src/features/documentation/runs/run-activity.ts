import type { RunView } from "./run-record";
import type { RunInvocationSummary } from "./run-invocation-summary";

export const activityLabels: Record<string, string> = {
  "prepare-context": "Preparing product context",
  "source-analysis": "Understanding the code change",
  "runtime-decision": "Deciding what to inspect",
  "runtime-inspection": "Inspecting the running product",
  "impact-synthesis": "Understanding product impact",
  "documentation-planning": "Finding affected documentation",
  "documentation-transformation": "Preparing documentation updates",
  "proposal-retention": "Ready for review",
  "read-evidence": "Reading changed files", "understand-impact": "Understanding the code change",
  "propose-documentation": "Preparing documentation updates", "validate-draft": "Verifying generated documentation",
};
export type ActivityStep = { label: string; status: string };
/** Project recorded boundaries only. Missing invocation logs never imply completion. */
export function activitySubsteps(stage: RunView["stages"][number], calls: RunInvocationSummary[], options: { supportRejected?: boolean } = {}): ActivityStep[] {
  const own = calls.filter(call => call.stage === stage.key);
  const operation = (name: string) => own.find(call => call.operation === name);
  const terminal = !["running", "waiting"].includes(stage.status);
  const status = (call: RunInvocationSummary | undefined) => !call ? terminal ? "not-recorded" : "waiting" : call.status === "failed" ? "failed" : call.status === "succeeded" ? "completed" : terminal ? "interrupted" : "running";
  if (stage.key === "source-analysis") {
    const call = operation("source-analysis");
    return [
      { label: "Reading changed files", status: call || stage.status === "completed" ? "completed" : stage.status === "running" ? "running" : stage.status === "failed" ? "failed" : "waiting" },
      { label: "Analyzing source facts", status: call?.status === "structured-success" ? "completed" : status(call) },
      { label: "Validating findings", status: call?.status === "succeeded" ? "completed" : call?.status === "structured-success" ? terminal ? "not-recorded" : "running" : call?.failureKind === "grounding-rejection" ? "failed" : terminal ? "not-recorded" : "waiting" },
    ];
  }
  if (stage.key === "documentation-planning") {
    const call = operation("documentation-planning");
    return [{ label: "Selecting documentation candidates", status: call || stage.status === "completed" ? "completed" : stage.status }, { label: "Planning section revisions", status: status(call) }];
  }
  const progress = "batchProgress" in stage ? stage.batchProgress : undefined;
  const batchStatus = (name: string) => {
    const matches = own.filter(call => call.operation === name);
    if (!matches.length) return status(undefined);
    if (matches.some(call => call.status === "failed")) return "failed";
    if (matches.some(call => call.status !== "succeeded")) return terminal ? "interrupted" : "running";
    if (!terminal && progress && (name === "documentation-transformation" ? matches.length < progress.total : progress.processed < progress.total)) return "waiting";
    return "completed";
  };
  if (stage.key === "documentation-transformation") return [
    { label: "Generating replacement copy", status: batchStatus("documentation-transformation") },
    ...(operation("documentation-composition") ? [{ label: "Composing with Muse Wonder", status: batchStatus("documentation-composition") }] : []),
    { label: "Checking evidence support", status: options.supportRejected ? "failed" : batchStatus("transformation-support") },
  ];
  return [];
}

export function activityBatchLabel(stage: RunView["stages"][number]) {
  const progress = "batchProgress" in stage ? stage.batchProgress : undefined;
  return progress && progress.total > 0 ? ` — ${progress.active ?? progress.processed} of ${progress.total} batches${progress.active ? "" : " processed"}` : "";
}
