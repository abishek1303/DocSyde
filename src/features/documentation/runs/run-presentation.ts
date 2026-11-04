import type { RunView } from "./run-record";
import { runFailureDescription, runFailureForView } from "./run-failure";

export function runOutcome(run: RunView) {
  if (run.reason === "impact-no-grounded-claims") return { title: "No grounded product claims remained", message: "Synthesis claims failed evidence-reference checks. Documentation planning was not started.", nextStep: "Review the retained source evidence and discarded-claim diagnostics before retrying." };
  if (run.reason === "impact-source-coverage-incomplete") return { title: "Source evidence was not fully accounted for", message: "Product-impact synthesis omitted or inconsistently accounted for supported source findings. Documentation planning was not started.", nextStep: "Review the impact-synthesis coverage diagnostic and source evidence before retrying." };
  const failure = runFailureForView(run);
  const description = failure ? runFailureDescription(failure.code) : null;
  if (run.reason === "proposal-no-publishable-updates") return { title: "No publishable documentation updates are available", message: "Validated work was retained, but no update has both accepted evidence support and a valid publication destination.", nextStep: "Check the coverage gaps. Use Documentation destinations to confirm a discovered screen, or review the current live document association. If no screen was verified, improve routing evidence before another scan." };
  if (run.reason === "proposal-review-resolved") return { title: "No pending changes remain", message: "This run no longer has actionable changes waiting for review.", nextStep: "Check Latest Docs for the current published documentation." };
  if (run.reason === "documentation-plan-unresolved-or-empty" && run.input.mode === "current-state" && run.outputs?.impactAssessment === "insufficient-evidence") return { title: "Product evidence was insufficient for documentation", message: "The planner received insufficient supported product claims and could not prepare a documentation update.", nextStep: "Review source and runtime coverage in the product-impact details before retrying." };
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
  const executable = run.runtimeStartup?.missingExecutable;
  const manager = executable && ["npm", "pnpm", "yarn"].includes(executable) ? `“${executable}”` : "the approved package manager";
  const reasons: Record<string, string> = {
    "managed-package-manager-missing": `DocSyde could not find ${manager}. Make it available in the terminal that starts DocSyde, then restart DocSyde and retry.`,
    "managed-project-dependencies-missing": "Project dependencies are not installed in the approved checkout. Install them there, then retry.",
    "managed-existing-server-unavailable": "Managed startup is disabled and the existing application server is unavailable.",
    "managed-approval-required": "The local startup configuration needs a new approval.",
    "managed-dependencies-missing": "The approved package manager or project dependencies are unavailable. Check both in the approved checkout before retrying.",
    "managed-port-occupied": "The expected URL is occupied by an unhealthy or different application.",
    "managed-startup-failed": "The application could not start. Check the target application’s local startup output, correct the issue, then retry.",
    "managed-readiness-timeout": "The application did not become ready before the timeout. Check its local startup output and the configured application URL and readiness endpoint, then retry.",
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
