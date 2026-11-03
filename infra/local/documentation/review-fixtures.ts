// Trusted deterministic producer fixture. Not an unsigned proposal import API.
import type { ProductImpact } from "@/features/sources/product-evidence";
import { randomUUID } from "node:crypto";
import { draftFixture } from "./draft-fixture";
import { transformationImpactFixture, transformationPlanFixture, transformationDecisionFixture, transformationEntryFixture } from "./transformation-fixtures";
import { documentationHash } from "@/features/documentation/documents/document-identity";
import { assembleDocumentationChange } from "@/features/documentation/transformation/assemble-documentation-change";
import { transformationSource, authorizeTransformation } from "@/features/documentation/transformation/transformation-input";
import { transformationSupportUnits } from "@/features/documentation/transformation/transformation-validation";
import type { DocumentationChangeProposal, DecisionResult } from "@/features/documentation/transformation/documentation-change-proposal";
import type { DocumentationDocument } from "@/features/documentation/documents/document";

export function reviewProposalFixture(baseline: DocumentationDocument = draftFixture(), extras = true, sectionIndex = 0, runtimeImpact?: ProductImpact): DocumentationChangeProposal {
  const proposalId = randomUUID(), createdAt = new Date().toISOString(), impact = runtimeImpact ?? transformationImpactFixture();
  impact.provenance.source.repository = baseline.provenance.repository;
  const decisions = [transformationDecisionFixture(baseline.id, baseline.sections[sectionIndex].id)];
  if (extras) decisions.push(transformationDecisionFixture(baseline.id, null, "add"), transformationDecisionFixture(baseline.id, null, "no-change"), transformationDecisionFixture(null, null, "unresolved"));
  const plan = transformationPlanFixture(impact, decisions);
  const results: DecisionResult[] = decisions.map((decision, i) => ({ decisionId: `decision-${i + 1}`, decision, generation: i < (extras ? 2 : 1) ? "generated" : "not-required",
    support: i < (extras ? 2 : 1) ? "supported" : "not-required", reviewReady: i < (extras ? 2 : 1), materialization: i < (extras ? 2 : 1) ? "pending" : "not-applicable",
    approval: "not-requested", saveCompatible: false, issues: [], limitations: [], change: null, model: i < (extras ? 2 : 1) ? { model: "mock-proof", elapsedMs: 1 } : null, candidateId: null }));
  const source = transformationSource(impact, proposalId, [baseline]);
  const authorizations = results.filter(r => r.reviewReady).map(r => authorizeTransformation(impact, plan, r, baseline, source, []));
  for (const result of results.filter(r => r.reviewReady)) result.change = transformationEntryFixture(authorizations.find(a => a.decisionId === result.decisionId)!, [{ documentId: baseline.id, sections: baseline.sections, outline: baseline.sections }]).change;
  const selected = results.filter(r => r.reviewReady);
  const document = assembleDocumentationChange({ proposalId, createdAt, planSha256: documentationHash(plan), baseline, results: selected, source, suppliedContext: [], limitations: [] });
  selected.forEach(r => { r.materialization = "ready"; r.saveCompatible = true; r.candidateId = document.id; });
  return { proposalId, createdAt, impactSha256: documentationHash(impact), planSha256: documentationHash(plan), status: "complete", impact, plan,
    targets: [{ identity: { documentId: baseline.id, sha256: documentationHash(baseline) }, document: baseline }], authorizations, results,
    candidates: [{ decisionIds: selected.map(r => r.decisionId), document }],
    batches: [{ decisionIds: selected.map(r => r.decisionId), requestBytes: 1000, status: "completed", model: { model: "mock-proof", elapsedMs: 1 } }],
    supportModel: { model: "mock-proof", elapsedMs: 1 }, supportAttempted: true, protocolIssues: [],
    supportChecks: authorizations.flatMap(auth => transformationSupportUnits(auth, results.find(r => r.decisionId === auth.decisionId)!.change!, baseline).map(u => ({ unitId: u.id, decisionId: auth.decisionId, verdict: "supported" as const, reason: "Mock proof evidence supports wording" }))) };
}

export function independentReviewProposalFixture(baselines: DocumentationDocument[]) {
  const p = reviewProposalFixture(baselines[0], false);
  p.targets = baselines.map(document => ({ document, identity: { documentId: document.id, sha256: documentationHash(document) } }));
  p.plan = transformationPlanFixture(p.impact, baselines.map(doc => transformationDecisionFixture(doc.id, doc.sections[0].id)));
  p.planSha256 = documentationHash(p.plan);
  p.results = p.plan.decisions.map((decision, index) => ({ ...structuredClone(p.results[0]), decisionId: `decision-${index + 1}`, decision, candidateId: null, materialization: "pending", saveCompatible: false }));
  const source = transformationSource(p.impact, p.proposalId, baselines);
  p.authorizations = p.results.map((r, i) => authorizeTransformation(p.impact, p.plan, r, baselines[i], source, []));
  p.candidates = p.results.map((r, i) => {
    r.change = transformationEntryFixture(p.authorizations[i], []).change;
    const document = assembleDocumentationChange({ proposalId: p.proposalId, createdAt: p.createdAt, planSha256: p.planSha256, baseline: baselines[i], results: [r], source, suppliedContext: [], limitations: [] });
    r.materialization = "ready"; r.saveCompatible = true; r.candidateId = document.id;
    return { decisionIds: [r.decisionId], document };
  });
  p.supportChecks = p.authorizations.flatMap((auth, i) => transformationSupportUnits(auth, p.results[i].change!, baselines[i]).map(u => ({ unitId: u.id, decisionId: auth.decisionId, verdict: "supported" as const, reason: "Mock supported wording" })));
  p.batches[0].decisionIds = p.results.map(r => r.decisionId);
  return p;
}
