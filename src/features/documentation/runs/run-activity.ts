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
export function activitySubsteps(stage: RunView["stages"][number], calls: RunInvocationSummary[]): ActivityStep[] {
  const own = calls.filter(call => call.stage === stage.key);
  const operation = (name: string) => own.find(call => call.operation === name);
  const status = (call: RunInvocationSummary | undefined) => !call ? "waiting" : call.status === "failed" ? "failed" : call.status === "succeeded" ? "completed" : "running";
  if (stage.key === "source-analysis") {
    const call = operation("source-analysis");
    return [
      { label: "Reading changed files", status: call || stage.status === "completed" ? "completed" : stage.status === "running" ? "running" : stage.status === "failed" ? "failed" : "waiting" },
      { label: "Analyzing source facts", status: call?.status === "structured-success" ? "completed" : status(call) },
      { label: "Validating findings", status: call?.status === "succeeded" ? "completed" : call?.status === "structured-success" ? "running" : call?.failureKind === "grounding-rejection" ? "failed" : "waiting" },
    ];
  }
  if (stage.key === "documentation-planning") {
    const call = operation("documentation-planning");
    return [{ label: "Selecting documentation candidates", status: call || stage.status === "completed" ? "completed" : stage.status }, { label: "Planning section revisions", status: status(call) }];
  }
  if (stage.key === "documentation-transformation") return [
    { label: "Generating replacement copy", status: status(operation("documentation-transformation")) },
    ...(operation("documentation-composition") ? [{ label: "Composing with Muse Wonder", status: status(operation("documentation-composition")) }] : []),
    { label: "Checking evidence support", status: status(operation("transformation-support")) },
  ];
  return [];
}
