import type { RuntimeObservationInput, RuntimeFailureCode } from "@/integrations/browser/runtime-observation";

const failures: Record<RuntimeFailureCode, string> = {
  "runtime-start-failed": "The application runtime could not start or attach. Check the trusted runtime configuration.",
  "application-readiness-failed": "The application health check did not become ready. The configured app may be stopped or unhealthy.",
  "browser-launch-failed": "Chromium could not launch. Check the installed browser and local browser permissions.",
  "browser-context-failed": "The browser session could not be initialized.",
  "navigation-failed": "The configured page could not be opened successfully.",
  "page-readiness-failed": "The page opened, but its configured readiness target did not become visible.",
  "state-capture-failed": "Runtime state could not be recorded at the current workflow boundary.",
  "action-failed": "The scripted action failed. Check its step and configured target in the trusted workflow.",
  "action-timeout": "The scripted action timed out. Its configured target may be missing, hidden or not ready.",
  "browser-cleanup-failed": "Browser cleanup failed. Captures cannot be promoted to retained evidence.",
  "artifact-storage-failed": "Capture or manifest storage failed. Unlinked previews are not retained evidence.",
  "run-linkage-failed": "The stored manifest could not be linked to this run. Previews are not retained evidence.",
  "capture-failed": "The capture workflow failed. Earlier events identify the last completed boundary.",
  "cleanup-failed": "Application runtime cleanup failed. Captures cannot be promoted to retained evidence.",
  "selection-failed": "Visual selection failed. Vision was not started for this selection.",
  "vision-failed": "Screenshot analysis failed. Any earlier retained captures remain available.",
  "cancelled": "Inspection was cancelled or reached its deadline. Cleanup runs before the session is released.",
  "interrupted": "Inspection was interrupted. Start a new run to inspect again.",
  "not-retained": "Inspection evidence was not retained.",
  "run-failed": "The run failed. Earlier inspection events may contain a more specific failure point.",
  "truncated": "Some inspection events were omitted by the history limits.",
};
export function runtimeFailureMessage(code: RuntimeFailureCode) { return failures[code]; }
export function inspectionEventLabel(event: RuntimeObservationInput): string {
  switch (event.kind) {
    case "runtime-session-starting": return "Preparing application inspection";
    case "application-launch-started": return "Starting application";
    case "application-stopping-started": return "Stopping application";
    case "application-process-exit": return "Application process exited";
    case "application-readiness-started": return "Waiting for application";
    case "application-readiness-completed": return "Application health check passed";
    case "runtime-session-started": return "Inspecting application";
    case "runtime-session-stopped": return "Application runtime released";
    case "browser-launch-started": return "Launching browser";
    case "browser-launched": return "Browser launched";
    case "browser-stopped": return "Browser closed";
    case "navigation-started": return `Opening ${event.pathname ?? "configured page"}`;
    case "navigation-completed": return `Page loaded${event.pathname ? `: ${event.pathname}` : ""}`;
    case "page-readiness-started": return "Waiting for page readiness";
    case "page-readiness-completed": return "Page readiness target is visible";
    case "action-started": case "action-completed": {
      const names = { click: "Clicking configured target", fill: "Filling masked input", select: "Selecting configured option", check: "Updating configured checkbox", uncheck: "Updating configured checkbox", press: "Pressing configured key", wait: "Waiting for configured target", waitFor: "Waiting for configured target", checkpoint: "Capturing checkpoint" };
      return `${event.kind === "action-completed" ? "Completed" : names[event.action]} · step ${event.actionIndex + 1}${event.kind === "action-completed" ? ` (${event.action})` : ""}`;
    }
    case "state-captured": return `Runtime state recorded: ${event.pathname}`;
    case "checkpoint-created": return event.eligible ? "Captured masked checkpoint" : `Checkpoint unavailable: ${event.limitation ?? "not eligible"}`;
    case "preview-available": return "Masked checkpoint preview available";
    case "screenshot-stored": return "Checkpoint PNG stored; awaiting run linkage";
    case "canonical-evidence-retained": return "Canonical evidence linked to run";
    case "visual-selection-started": return "Selecting visual evidence";
    case "visual-selection-completed": return event.skipped ? "Visual selection skipped images" : `Selected ${event.selected.length} captured image${event.selected.length === 1 ? "" : "s"}`;
    case "vision-analysis-started": return "Analyzing screenshot";
    case "vision-analysis-completed": return "Screenshot analysis completed";
    case "failure": case "warning": return runtimeFailureMessage(event.code);
  }
}
