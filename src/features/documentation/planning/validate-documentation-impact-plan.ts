import { withValidationDiagnostic } from "@/integrations/ai/invocation-debug";
import { isDeepStrictEqual } from "node:util";
import type { ProductImpact } from "@/features/sources/product-analysis";
import { documentationImpactPlanSchema, type DocumentationImpactPlan } from "./documentation-impact";
import { documentationImpactClaims, projectDocumentationImpact } from "./documentation-impact-input";

type Targets = { id: string; sections: { id: string }[] }[];
export function validateImpactDecisions(impact: ProductImpact, decisions: DocumentationImpactPlan["decisions"], documents: Targets) {
  const claims = new Map(projectDocumentationImpact(impact, documentationImpactClaims(impact)).claims.map(claim => [claim.id, claim]));
  for (const [decisionIndex, decision] of decisions.entries()) {
    if (new Set(decision.claimRefs).size !== decision.claimRefs.length || decision.claimRefs.some(id => !claims.has(id))) throw withValidationDiagnostic(new Error("Unknown or duplicate documentation claim reference."), { validator: "documentation-planning", code: "unknown-claim-reference", path: `decisions[${decisionIndex}].claimRefs` });
    const document = documents.find(document => document.id === decision.documentId);
    if ((decision.documentId !== null && !document) || (decision.sectionId !== null && !document?.sections.some(section => section.id === decision.sectionId))) throw withValidationDiagnostic(new Error("Unknown or mismatched documentation target."), { validator: "documentation-planning", code: "mismatched-document-target", path: `decisions[${decisionIndex}].documentId` });
    if ((decision.action === "revise" || decision.action === "no-change") && !document) throw withValidationDiagnostic(new Error("Documentation action requires an existing target."), { validator: "documentation-planning", code: "missing-document-target", path: `decisions[${decisionIndex}].documentId` });
    if (decision.action === "add" && decision.sectionId !== null) throw withValidationDiagnostic(new Error("New sections/documents cannot have invented or existing section targets."), { validator: "documentation-planning", code: "illegal-add-target", path: `decisions[${decisionIndex}].sectionId` });
    if (decision.action !== "unresolved" && (impact.assessment === "insufficient-evidence" || impact.contradictions.length)) throw withValidationDiagnostic(new Error("Uncertain ProductImpact requires unresolved documentation decisions."), { validator: "documentation-planning", code: "uncertain-impact-requires-unresolved", path: `decisions[${decisionIndex}].action` });
    if ((decision.action === "revise" || decision.action === "add") && !decision.claimRefs.some(id => claims.get(id)?.sourceSupported)) throw withValidationDiagnostic(new Error("Documentation updates require source-supported claims."), { validator: "documentation-planning", code: "missing-source-support", path: `decisions[${decisionIndex}].claimRefs` });
    if ((decision.action === "revise" || decision.action === "add") && !decision.updateIntent.trim()) throw withValidationDiagnostic(new Error("Documentation updates require an intent."), { validator: "documentation-planning", code: "missing-update-intent", path: `decisions[${decisionIndex}].updateIntent` });
  }
}

/** Correspondence is not authentication. Accept direct trusted server output. */
export function validateDocumentationImpactPlan(impact: ProductImpact, raw: unknown) {
  const plan = documentationImpactPlanSchema.parse(raw);
  if (plan.objective === "fresh" && (plan.source.base !== plan.source.head || plan.decisions.some(decision => !["add", "unresolved"].includes(decision.action) || decision.documentId !== null || decision.sectionId !== null)
    || (plan.candidateSelection && (plan.candidateSelection.selectedDocumentIds.length || plan.candidateSelection.matches.length)))) throw new Error("Fresh planning cannot depend on previous documentation.");
  if (plan.candidateSelection && (plan.candidateSelection.coverage === "incomplete" || plan.decisions.some(d => d.documentId !== null && !plan.candidateSelection!.selectedDocumentIds.includes(d.documentId)))) throw new Error("Plan target is outside selected candidates.");
  const { repository, base, head, limited, notice, uncertainties } = impact.provenance.source;
  if (!isDeepStrictEqual(plan.source, { repository, base, head })
    || !isDeepStrictEqual(plan.claimCatalog, documentationImpactClaims(impact))
    || !isDeepStrictEqual(plan.qualifications, { ...(impact.provenance.runtimeInspection ? { runtimeInspection: impact.provenance.runtimeInspection } : {}), assessment: impact.assessment, uncertainties: impact.uncertainties,
      contradictions: impact.contradictions, source: { limited, notice, uncertainties } })) throw new Error("Documentation plan does not match its impact.");
  return plan;
}
