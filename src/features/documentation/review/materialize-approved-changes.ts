import "server-only";
import { isDeepStrictEqual } from "node:util";
import type { DocumentationChangeProposal, DecisionResult } from "../transformation/documentation-change-proposal";
import { assembleDocumentationChange } from "../transformation/assemble-documentation-change";
import { transformationSource } from "../transformation/transformation-input";
import { transformationSupportUnits, validateTransformationEntry } from "../transformation/transformation-validation";
import { documentationId } from "../documents/document-identity";

export function intrinsicReviewReady(proposal: DocumentationChangeProposal, result: DecisionResult) {
  const auth = proposal.authorizations.find(auth => auth.decisionId === result.decisionId);
  const baseline = proposal.targets.find(target => target.identity.documentId === result.decision.documentId)?.document;
  if (!auth || !result.change || result.change.kind === "incomplete" || result.generation !== "generated"
    || result.support !== "supported" || !result.reviewReady || !result.model || !proposal.supportAttempted || !proposal.supportModel) return false;
  validateTransformationEntry({ decisionId: result.decisionId, target: auth.target, change: result.change }, auth, baseline);
  if (result.change.kind === "add-section" && result.change.placement.position === "undetermined") return false;
  const units = transformationSupportUnits(auth, result.change, baseline);
  return units.length > 0 && units.every(unit => {
    const checks = proposal.supportChecks.filter(check => check.unitId === unit.id && check.decisionId === result.decisionId);
    return checks.length === 1 && checks[0].verdict === "supported";
  });
}
export function approvedDocumentUnits(proposal: DocumentationChangeProposal, ids: string[]) {
  const units = new Map<string, DecisionResult[]>();
  for (const result of proposal.results) if (ids.includes(result.decisionId)) {
    const key = result.decision.documentId ?? result.decisionId;
    units.set(key, [...(units.get(key) ?? []), result]);
  }
  return [...units].map(([unitId, results]) => ({ unitId, results }));
}
export function proposalOperatorContext(proposal: DocumentationChangeProposal, results = proposal.results) {
  const choices = proposal.authorizations.filter(auth => results.some(result => result.decisionId === auth.decisionId)).flatMap(auth => auth.associations);
  const unique = new Map<string, typeof choices[number]>();
  for (const choice of choices) {
    if (unique.has(choice.id) && !isDeepStrictEqual(unique.get(choice.id), choice)) throw new Error("Conflicting operator context.");
    unique.set(choice.id, choice);
  }
  return [...unique.values()];
}
export function materializeApprovedUnit(proposal: DocumentationChangeProposal, operationId: string, results: DecisionResult[]) {
  if (!results.length || results.some(result => !intrinsicReviewReady(proposal, result))) throw new Error("Decision is intrinsically blocked.");
  const source = transformationSource(proposal.impact, proposal.proposalId, proposal.targets.map(target => target.document));
  const baseline = proposal.targets.find(target => target.identity.documentId === results[0].decision.documentId)?.document;
  if (results[0].decision.documentId && !baseline) throw new Error("Missing frozen baseline.");
  const namespace = documentationId(`${proposal.proposalId}:${operationId}:${results.map(result => result.decisionId).join(",")}`);
  return assembleDocumentationChange({ proposalId: namespace, createdAt: proposal.createdAt, planSha256: proposal.planSha256,
    baseline, results, source, suppliedContext: proposalOperatorContext(proposal, results), limitations: [...new Set(results.flatMap(result => result.limitations))] });
}
