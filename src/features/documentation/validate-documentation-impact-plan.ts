import { isDeepStrictEqual } from "node:util";
import type { ProductImpact } from "@/features/sources/product-analysis";
import { documentationImpactPlanSchema, type DocumentationImpactPlan } from "./documentation-impact";
import { documentationImpactClaims, projectDocumentationImpact } from "./documentation-impact-input";

type Targets = { id: string; sections: { id: string }[] }[];
export function validateImpactDecisions(impact: ProductImpact, decisions: DocumentationImpactPlan["decisions"], documents: Targets) {
  const claims = new Map(projectDocumentationImpact(impact, documentationImpactClaims(impact)).claims.map(claim => [claim.id, claim]));
  for (const decision of decisions) {
    if (new Set(decision.claimRefs).size !== decision.claimRefs.length || decision.claimRefs.some(id => !claims.has(id))) throw new Error("Unknown or duplicate documentation claim reference.");
    const document = documents.find(document => document.id === decision.documentId);
    if ((decision.documentId !== null && !document) || (decision.sectionId !== null && !document?.sections.some(section => section.id === decision.sectionId))) throw new Error("Unknown or mismatched documentation target.");
    if ((decision.action === "revise" || decision.action === "no-change") && !document) throw new Error("Documentation action requires an existing target.");
    if (decision.action === "add" && decision.sectionId !== null) throw new Error("New sections/documents cannot have invented or existing section targets.");
    if (decision.action !== "unresolved" && (impact.assessment === "insufficient-evidence" || impact.contradictions.length)) throw new Error("Uncertain ProductImpact requires unresolved documentation decisions.");
    if ((decision.action === "revise" || decision.action === "add") && !decision.claimRefs.some(id => claims.get(id)?.sourceSupported)) throw new Error("Documentation updates require source-supported claims.");
    if ((decision.action === "revise" || decision.action === "add") && !decision.updateIntent.trim()) throw new Error("Documentation updates require an intent.");
  }
}

/** Correspondence is not authentication. Accept direct trusted server output. */
export function validateDocumentationImpactPlan(impact: ProductImpact, raw: unknown) {
  const plan = documentationImpactPlanSchema.parse(raw);
  const { repository, base, head, limited, notice, uncertainties } = impact.provenance.source;
  if (!isDeepStrictEqual(plan.source, { repository, base, head })
    || !isDeepStrictEqual(plan.claimCatalog, documentationImpactClaims(impact))
    || !isDeepStrictEqual(plan.qualifications, { assessment: impact.assessment, uncertainties: impact.uncertainties,
      contradictions: impact.contradictions, source: { limited, notice, uncertainties } })) throw new Error("Documentation plan does not match its impact.");
  return plan;
}
