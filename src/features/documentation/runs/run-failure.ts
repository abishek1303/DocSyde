import type { CandidateSelection } from "../planning/candidate-selection";
import type { ModelDiagnostic } from "@/integrations/ai/model-diagnostic";
// Public failure descriptions are fixed application text, never provider messages.
export const RUN_FAILURE_CODES = [
  "source-credentials", "source-access", "source-not-found", "source-rate-limit", "source-timeout", "source-history", "source-incomplete", "source-input", "source-unavailable", "evidence-budget", "evidence-validation",
  "model-credentials", "model-access", "model-billing", "model-rate-limit", "model-timeout", "model-unavailable", "model-output", "model-failed",
  "database-unavailable", "database-schema", "invalid-data", "runtime-failed", "candidates-incomplete", "transformation-failed", "deadline", "heartbeat", "stage-failed", "details-unavailable",
] as const;
export type RunFailureCode = typeof RUN_FAILURE_CODES[number];
export type RunFailure = { stage: string; code: RunFailureCode; diagnostic?: ModelDiagnostic; candidateSelection?: CandidateSelection["diagnostics"] };
const descriptions: Record<RunFailureCode, { message: string; nextStep: string }> = {
  "source-credentials": { message: "GitHub access is not configured.", nextStep: "Configure GITHUB_TOKEN on the server, then rerun this comparison." },
  "source-access": { message: "GitHub denied access to this repository.", nextStep: "Check the token’s repository permissions and organization access, then rerun." },
  "source-not-found": { message: "GitHub could not find the repository or a selected revision.", nextStep: "Check repository access and whether the branch or pinned commits still exist." },
  "source-rate-limit": { message: "GitHub’s rate limit was reached.", nextStep: "Wait for the rate limit to reset, then rerun this comparison." },
  "source-timeout": { message: "Reading source evidence timed out.", nextStep: "Check GitHub connectivity or choose a smaller comparison, then rerun." },
  "source-history": { message: "The comparison base is not an ancestor of the selected commit.", nextStep: "Return to run setup and choose a base from this branch’s history." },
  "source-incomplete": { message: "GitHub could not provide a complete comparison within the source limits.", nextStep: "Choose a smaller range: up to 100 commits and fewer than 300 changed files." },
  "source-input": { message: "A source revision or path was invalid.", nextStep: "Check the selected revisions and additional source paths in run setup." },
  "source-unavailable": { message: "GitHub could not return the source evidence.", nextStep: "Check GitHub connectivity and repository access, then rerun." },
  "evidence-budget": { message: "The selected source evidence exceeded the analysis size limit.", nextStep: "Choose a smaller comparison or fewer additional source paths." },
  "evidence-validation": { message: "The generated analysis did not match its source evidence.", nextStep: "No unsupported result was accepted. Review the comparison and try a new attempt." },
  "model-credentials": { message: "The model provider is not configured.", nextStep: "Configure the model credentials for this stage on the server, then rerun." },
  "model-access": { message: "The model provider rejected access.", nextStep: "Check the server’s model credentials and permissions, then rerun." },
  "model-billing": { message: "The model provider could not process the request because of billing.", nextStep: "Check the provider’s credit balance and billing settings before retrying." },
  "model-rate-limit": { message: "The model provider’s rate limit was reached.", nextStep: "Wait before starting a new attempt." },
  "model-timeout": { message: "The model request timed out.", nextStep: "Try a new attempt, or reduce the comparison size if this repeats." },
  "model-unavailable": { message: "The configured model is unavailable.", nextStep: "Check the model configured for this stage and its availability." },
  "model-output": { message: "The model returned incomplete or invalid structured output.", nextStep: "No invalid output was accepted. Start a new attempt to retry." },
  "model-failed": { message: "The model request did not complete successfully.", nextStep: "Check the provider’s availability and server configuration, then retry." },
  "database-unavailable": { message: "The run could not access its database.", nextStep: "Check PostgreSQL connectivity and DATABASE_URL before retrying." },
  "database-schema": { message: "The database schema required by this stage is unavailable.", nextStep: "Apply the documented database migrations, then rerun." },
  "invalid-data": { message: "This stage received data that failed validation.", nextStep: "Check the run’s configuration and saved inputs before starting a new attempt." },
  "runtime-failed": { message: "The runtime inspection could not complete.", nextStep: "Check the local app’s readiness, configured workflow and browser availability, then rerun." },
  "candidates-incomplete": { message: "Documentation targets could not be narrowed safely.", nextStep: "Review candidate-selection details for overlapping supported targets or retrieval limits. Add specific source or feature context, or narrow the comparison before rerunning." },
  "transformation-failed": { message: "Documentation generation or its support check did not complete.", nextStep: "Check the model provider and review the retained evidence before retrying." },
  "deadline": { message: "The run reached its execution time limit.", nextStep: "Choose a smaller comparison before starting a new attempt." },
  "heartbeat": { message: "The run could not renew its execution heartbeat.", nextStep: "Check database connectivity and the application process before retrying." },
  "stage-failed": { message: "This stage could not complete.", nextStep: "Check the configuration and services used by this stage, then start a new attempt." },
  "details-unavailable": { message: "This older run did not retain a detailed failure cause.", nextStep: "Start a new attempt to capture a sanitized failure reason. The original cause cannot be recovered from this record." },
};
export function runFailureDescription(code: RunFailureCode) { return Object.hasOwn(descriptions, code) ? descriptions[code] : descriptions["stage-failed"]; }
export const RUN_STAGE_LABELS: Record<string, string> = {
  "prepare-context": "Prepare context", "source-analysis": "Analyze source changes", "runtime-decision": "Plan runtime inspection", "runtime-inspection": "Inspect the running app", "impact-synthesis": "Understand product impact", "documentation-planning": "Identify documentation updates", "documentation-transformation": "Prepare documentation", "proposal-retention": "Save proposal for review", execution: "Run execution",
};
export function runFailureForView(run: { failure?: RunFailure; status: string; stages: { key: string; status: string }[] }): RunFailure | undefined {
  if (run.failure) return run.failure;
  if (run.status !== "failed") return;
  return { stage: run.stages.find(stage => stage.status === "failed")?.key ?? "execution", code: "details-unavailable" };
}
