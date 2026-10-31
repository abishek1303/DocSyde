// Deterministic test/proof fixtures only. Never seeded by product operations.
import type { ProductImpact } from "@/features/sources/product-analysis";
import type { DocumentationImpactPlan } from "@/features/documentation/documentation-impact";
import { documentationImpactClaims } from "@/features/documentation/documentation-impact-input";
import type { TransformationAuthorization } from "@/features/documentation/transformation-input";
import type { TransformationChange } from "@/features/documentation/documentation-change-proposal";

export function transformationImpactFixture(count = 1): ProductImpact {
  const sourceReferences = Array.from({ length: count }, (_, i) => ({ id: `source-${i + 1}`, findingIndex: i, finding: {
    kind: "field-requirement-changed" as const, description: i ? "A request description is now required" : "A request title is now required",
    before: "Optional", after: "Required", support: "directly-supported" as const, confidence: "high" as const, confidenceReason: "Literal source",
    citations: [{ evidenceId: `patch-${i + 1}`, startLine: 1, endLine: 1, excerpt: "+required" }],
    reachabilityEvidenceIds: [], assumptions: [], uncertainties: [],
  } }));
  return { assessment: "product-change", summary: "Request requirements changed", claims: sourceReferences.map(entry => ({
    description: entry.finding.description, kind: "behavior-change", before: "Optional", after: "Required", confidence: "high",
    confidenceReason: "Literal source", uncertainties: [], references: [entry.id],
  })), uncertainties: ["Runtime revision identity unverified"], contradictions: [], provenance: {
    source: { repository: "https://github.com/abishek1303/DocSyde", base: "c".repeat(40), head: "d".repeat(40), limited: false,
      notice: "Selected current source", uncertainties: [] }, sourceReferences,
    sourceEvidence: sourceReferences.map((entry, i) => ({ id: `patch-${i + 1}`, path: `form-${i}.ts`, side: "patch", commitId: null, contentId: null })),
    captures: [], visualReferences: [],
  } };
}

export function transformationPlanFixture(impact: ProductImpact, decisions: DocumentationImpactPlan["decisions"]): DocumentationImpactPlan {
  const { repository, base, head, limited, notice, uncertainties } = impact.provenance.source;
  return { decisions, uncertainties: ["Review proposed wording"], source: { repository, base, head }, claimCatalog: documentationImpactClaims(impact),
    qualifications: { assessment: impact.assessment, uncertainties: impact.uncertainties, contradictions: impact.contradictions, source: { limited, notice, uncertainties } } };
}

export function transformationDecisionFixture(documentId: string | null, sectionId: string | null = null, action: DocumentationImpactPlan["decisions"][number]["action"] = "revise", claimRefs = ["claim-1"]) {
  return { action, documentId, sectionId, reason: "The supplied source-supported requirement needs accurate guidance.", updateIntent: action === "revise" || action === "add" ? "Explain the current requirement." : "", claimRefs };
}

export function transformationEntryFixture(auth: TransformationAuthorization, documents: { documentId: string; sections: { id: string }[]; outline: { id: string }[] }[], ambiguous = false) {
  const usedFacts = auth.claims.map(claim => auth.facts.find(fact => fact.claimRefs.includes(claim.id) && fact.field === "after") ?? auth.facts.find(fact => fact.claimRefs.includes(claim.id))!);
  const section = { title: "Request requirements", kind: "requirements" as const, associations: [], content: [{ markdown: "A request title is required.",
    factRefs: [...new Set(usedFacts.map(fact => fact.id))], claimRefs: auth.claims.map(claim => claim.id) }] };
  let change: TransformationChange;
  if (auth.shape === "replace-section") change = { kind: auth.shape, section };
  else if (auth.shape === "add-section") change = { kind: auth.shape, section, placement: { position: ambiguous ? "undetermined" : "after",
    sectionId: ambiguous ? null : documents.find(doc => doc.documentId === auth.target.documentId)!.outline[0].id,
    reason: ambiguous ? "The outline does not establish an insertion point." : "The new requirement follows the existing first section." } };
  else if (auth.shape === "add-document") change = { kind: auth.shape, title: "Request requirements", associations: [], sections: [section] };
  else change = { kind: auth.shape, title: "Request requirements", associations: [], sections: documents.find(doc => doc.documentId === auth.target.documentId)!.sections.map((existing, index) =>
    index === 0 ? { kind: "write" as const, sectionId: existing.id, section } : { kind: "retain" as const, sectionId: existing.id }) };
  return { decisionId: auth.decisionId, target: auth.target, change };
}
