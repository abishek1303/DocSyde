import type { DocumentationChangeProposal } from "./documentation-change-proposal";

type Check = DocumentationChangeProposal["supportChecks"][number];
/** Missing/legacy negative verdicts remain blocking. Only explicit semantic categories permit review. */
export function checkRisk(check: Check): "ready" | "warnings" | "blocked" {
  if (check.verdict === "supported") return !check.category || check.category === "none" ? "ready" : "blocked";
  return check.category && ["omission", "ambiguity", "terminology"].includes(check.category) && check.factRefs?.length
    ? "warnings" : "blocked";
}
export function groundingRisk(checks: Check[]) {
  return !checks.length || checks.some(check => checkRisk(check) === "blocked") ? "blocked"
    : checks.some(check => checkRisk(check) === "warnings") ? "warnings" : "ready";
}
export function guideWarnings(proposal: DocumentationChangeProposal, decisionId: string) {
  return proposal.supportChecks.filter(check => check.decisionId === decisionId && checkRisk(check) === "warnings");
}
export function riskCounts(results: { generation: string; reviewReady: boolean; reviewOutcome?: string }[]) {
  const actionable = results.filter(result => result.generation !== "not-required");
  return { ready: actionable.filter(result => result.reviewReady && result.reviewOutcome !== "warnings").length,
    warnings: actionable.filter(result => result.reviewReady && result.reviewOutcome === "warnings").length,
    blocked: actionable.filter(result => !result.reviewReady).length };
}
