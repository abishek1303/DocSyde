import "server-only";
import type { z } from "zod";
import type { ProductImpact } from "@/features/sources/product-analysis";
import { fact, provenance, evidenceContextSchema, type AssociationChoice, type DocumentationDocument } from "../documents/document";
import type { DocumentationImpactPlan } from "../planning/documentation-impact";
import { documentationHash, documentationId } from "../documents/document-identity";
import type { DecisionResult, TransformationAuthorization } from "./documentation-change-proposal";
export type { TransformationAuthorization } from "./documentation-change-proposal";

export type TransformationSource = {
  repository: string;
  context: z.infer<typeof evidenceContextSchema>;
  facts: z.infer<typeof fact>[];
  findings: (z.infer<typeof provenance>["findings"][number] & { contextId: string })[];
  evidence: (z.infer<typeof provenance>["evidence"][number] & { contextId: string })[];
  sourceFindingIds: Map<string, string>;
};

export function transformationSource(impact: ProductImpact, proposalId: string, baselines: DocumentationDocument[]): TransformationSource {
  const contextId = documentationId(`${proposalId}:context`);
  const existing = new Set(baselines.flatMap(doc => [...doc.provenance.facts, ...doc.provenance.findings, ...doc.provenance.evidence, ...doc.context].map(item => item.id)));
  let prefix = `r-${documentationHash(impact).slice(0, 12)}-`, counter = 0;
  while ([...existing].some(id => id.startsWith(prefix))) prefix = `r-${documentationHash(impact).slice(0, 12)}-${++counter}-`;
  const sourceFindingIds = new Map(impact.provenance.sourceReferences.map(source => [source.id, `${prefix}${source.id}`]));
  const findings = impact.provenance.sourceReferences.map(source => {
    const claims = impact.claims.filter(claim => claim.kind !== "visual-observation" && claim.references.includes(source.id));
    const levels = ["low", "medium", "high"] as const;
    const confidence = levels[Math.min(levels.indexOf(source.finding.confidence), ...claims.map(claim => levels.indexOf(claim.confidence)))];
    return {
      id: sourceFindingIds.get(source.id)!, contextId, kind: source.finding.kind,
      description: source.finding.description, before: source.finding.before, after: source.finding.after,
      qualifications: { support: source.finding.support, confidence,
        confidenceReason: [source.finding.confidenceReason, ...claims.map(claim => claim.confidenceReason)].join("; "),
        assumptions: [...source.finding.assumptions], uncertainties: [...new Set([...source.finding.uncertainties, ...claims.flatMap(claim => claim.uncertainties)])] },
      citations: source.finding.citations.map(citation => ({ ...citation, evidenceId: `${prefix}${citation.evidenceId}` })),
    };
  });
  const facts = findings.flatMap(finding => (["description", "after"] as const).flatMap(field => {
    const value = finding[field];
    return value ? [{ id: `${finding.id}-${field}`, findingRef: finding.id, field, value, qualifications: structuredClone(finding.qualifications) }] : [];
  }));
  return { repository: impact.provenance.source.repository, context: { id: contextId, base: impact.provenance.source.base, head: impact.provenance.source.head,
    assessment: impact.assessment, limited: impact.provenance.source.limited,
    limitations: [...new Set([impact.provenance.source.notice, ...impact.provenance.source.uncertainties, ...impact.uncertainties])] },
    facts, findings, evidence: impact.provenance.sourceEvidence.map(e => ({ ...e, id: `${prefix}${e.id}`, contextId })), sourceFindingIds };
}

export function authorizeTransformation(impact: ProductImpact, plan: DocumentationImpactPlan, result: DecisionResult, baseline: DocumentationDocument | undefined, source: TransformationSource, supplied: AssociationChoice[]): TransformationAuthorization {
  const decision = result.decision;
  const claims = plan.claimCatalog.filter(entry => decision.claimRefs.includes(entry.id)
    && entry.claim.kind !== "visual-observation" && entry.claim.references.some(ref => source.sourceFindingIds.has(ref)));
  if (!claims.length) throw new Error("No source-supported transformation claims.");
  if (impact.assessment === "internal-only") {
    if (decision.action !== "revise" || !baseline) throw new Error("Internal-only additions are not authorized.");
    const sections = baseline.sections.filter(section => !decision.sectionId || section.id === decision.sectionId);
    const anchors = sections.flatMap(section => [section.title, ...section.content.map(block => block.markdown)]).filter(text => text.length >= 8);
    if (!anchors.some(text => decision.reason.includes(text))) throw new Error("Internal revision needs an exact existing title/text anchor in its reason.");
  }
  const facts = source.facts.flatMap(fact => {
    const claimRefs = claims.filter(entry => entry.claim.references.some(ref => source.sourceFindingIds.get(ref) === fact.findingRef)).map(entry => entry.id);
    return claimRefs.length ? [{ ...fact, claimRefs }] : [];
  });
  if (!facts.length) throw new Error("No usable current facts.");
  const findingIds = new Set(facts.map(fact => fact.findingRef));
  const evidenceRefs = [...new Set(source.findings.filter(finding => findingIds.has(finding.id)).flatMap(finding => finding.citations.map(citation => citation.evidenceId)))];
  return { decisionId: result.decisionId, decision, target: { documentId: decision.documentId, sectionId: decision.sectionId,
    snapshotSha256: baseline ? documentationHash(baseline) : null },
    shape: decision.action === "revise" ? decision.sectionId ? "replace-section" : "replace-document" : decision.documentId ? "add-section" : "add-document",
    claims: claims.map(({ id, claim }) => ({ id, claim })), facts, evidenceRefs,
    // Finding-origin choices are retained by exact baseline copies. New prose can
    // select operator associations only, rather than relabel historical support.
    associations: [...new Map([...(baseline?.context ?? []), ...supplied].filter(choice => choice.origin === "operator" || (choice.origin === "discovery" && choice.kind === "route" && choice.routeEvidence?.commitId === impact.provenance.source.head)).map(choice => [choice.id, choice])).values()], limitations: result.limitations };
}
