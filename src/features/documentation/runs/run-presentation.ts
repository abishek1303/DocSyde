import type { RunView } from "./run-record";
import { runFailureDescription, runFailureForView } from "./run-failure";

export function runOutcome(run: RunView) {
  const failure = runFailureForView(run);
  const description = failure ? runFailureDescription(failure.code) : null;
  if (run.status === "no-change") return { title: "No documentation update is needed", message: "The recorded analysis found no update to prepare.", nextStep: "Use Full Scan to reassess documentation against the current repository." };
  if (run.status === "cancelled") return { title: "This run was cancelled", message: "No proposal was retained for review.", nextStep: "Start a new run when you are ready." };
  if (run.outputs?.supportRejected && !run.retainedProposal) return {
    title: "Documentation did not pass evidence checks",
    message: "Documentation couldn't be prepared because some generated statements weren't supported by the available evidence.",
    nextStep: "Add specific product context or improve source/runtime coverage, then start a new Full Scan. Support checking will run again.",
  };
  const reasons: Record<string, [string, string, string?]> = {
    "outside-single-batch-baseline-scope": ["The verification limit stopped documentation generation", "The documentation plan did not fit this verification's single-batch limit. Generation was stopped before any replacement copy was requested.", "Inspect the recorded plan and verification limits before authorizing another attempt. This result does not establish whether normal generation would succeed."],
    "transformation-not-review-ready": ["Generated documentation was not accepted for review", "Generated output did not pass all support or materialization checks."],
    "impact-has-no-usable-claims": ["The evidence did not establish enough product behavior", "No supported product claims were available for documentation planning."],
    "documentation-plan-unresolved-or-empty": ["Documentation targets could not be resolved", "The planner could not identify a supported documentation update."],
  };
  const reason = reasons[run.reason ?? ""];
  return { title: reason?.[0] ?? description?.message ?? "The run stopped before review",
    message: reason?.[1] ?? description?.message ?? "This run ended without a review-ready proposal.",
    nextStep: reason?.[2] ?? description?.nextStep ?? "Review the stage details, add useful product context, then start a new Full Scan." };
}

/** Correct historical records that completed generation before rejecting support. */
export function presentedStage(run: RunView, stage: RunView["stages"][number]) {
  if (stage.key === "documentation-transformation" && stage.status === "completed" && !run.retainedProposal
    && ["transformation-not-review-ready", "transformation-provider-or-support-failure"].includes(run.reason ?? "")) {
    return { ...stage, status: run.status === "failed" ? "failed" as const : "incomplete" as const, summary: "Generated output was not accepted for review." };
  }
  return stage;
}
export function pendingChangesHref(run: RunView) {
  return `/docs?${new URLSearchParams({ repository: `${run.input.owner}/${run.input.repo}`, tab: "pending", ...(run.retainedProposal ? { proposal: run.retainedProposal.proposalId } : {}) })}`;
}
export function showRuntimeOutput(stage: RunView["stages"][number]) {
  return stage.key === "runtime-inspection" && !["waiting", "skipped"].includes(stage.status);
}

export function skippedRuntimeExplanation(run: RunView) {
  const reasons: Record<string, string> = {
    "managed-existing-server-unavailable": "Managed startup is disabled and the existing application server is unavailable.",
    "managed-approval-required": "The local startup configuration needs a new approval.",
    "managed-dependencies-missing": "The approved package manager or project dependencies are unavailable.",
    "managed-port-occupied": "The expected URL is occupied by an unhealthy or different application.",
    "managed-startup-failed": "The approved startup command could not start the application.",
    "managed-readiness-timeout": "The application did not become ready at its approved URL before the timeout.",
    "managed-unsupported-platform": "Managed startup needs POSIX process-group support; use an existing server instead.",
    "no-trusted-workflow": "No trusted runtime workflow is configured.",
    "no-repository-workflow": "No runtime workflow is configured for this repository.",
    "runtime-inspection-disabled": "Runtime inspection is disabled in this workflow.",
    "vision-capability-unavailable": "Screenshot analysis is not configured.",
    "browser-capability-unavailable": "The configured browser is unavailable.",
    "artifact-storage-unavailable": "Screenshot storage is unavailable.",
    "invalid-runtime-configuration": "The runtime configuration could not be loaded.",
  };
  const reason = reasons[run.runtime?.reason ?? ""] ?? (run.runtime?.decision === "not-needed" ? "The recorded decision did not require runtime inspection." : "The run did not reach an executable runtime inspection.");
  return `Runtime inspection was skipped. ${reason} No screenshots were captured for this run.`;
}
