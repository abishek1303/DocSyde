import "server-only";
import { isDeepStrictEqual } from "node:util";
import { validateProductImpact } from "@/features/sources/product-evidence";
import { documentationChangeProposalSchema } from "./documentation-change-proposal";
import { validateDocumentationDocument } from "../documents/document-validation";
import { documentationHash } from "../documents/document-identity";
import { validateDocumentationImpactPlan, validateImpactDecisions } from "../planning/validate-documentation-impact-plan";
import { authorizeTransformation, transformationSource } from "./transformation-input";
import { proposalOperatorContext } from "../review/materialize-approved-changes";
import { validateTransformationEntry, transformationSupportUnits } from "./transformation-validation";
import { assembleDocumentationChange } from "./assemble-documentation-change";
import { REVIEW_PROPOSAL_MAX_BYTES } from "../review/documentation-review";

/** Correspondence checks are not authentication. Only trusted producer code may retain this output. */
export function validateDocumentationProposal(raw: unknown) {
  if (Buffer.byteLength(JSON.stringify(raw)) > REVIEW_PROPOSAL_MAX_BYTES) throw new Error("Proposal exceeds retention bound.");
  const p = documentationChangeProposalSchema.parse(raw);
  const assert = (condition: boolean) => { if (!condition) throw new Error("Inconsistent documentation proposal."); };
  const impact = validateProductImpact(p.impact);
  validateDocumentationImpactPlan(impact, p.plan);
  assert(p.impactSha256 === documentationHash(impact) && p.planSha256 === documentationHash(p.plan));
  assert(p.results.length === p.plan.decisions.length);
  assert(new Set(p.targets.map(t => t.identity.documentId)).size === p.targets.length);
  assert(new Set(p.authorizations.map(a => a.decisionId)).size === p.authorizations.length);
  for (const target of p.targets) {
    const doc = validateDocumentationDocument(target.document);
    const selectedHash = p.plan.candidateSelection?.matches.find(m => m.documentId === doc.id)?.documentSha256;
    assert(!selectedHash || selectedHash === target.identity.sha256);
    assert(doc.id === target.identity.documentId && documentationHash(doc) === target.identity.sha256);
    assert(doc.provenance.repository.toLowerCase() === impact.provenance.source.repository.toLowerCase());
    assert(p.plan.decisions.some(d => d.documentId === doc.id));
  }
  assert(p.authorizations.every(a => a.associations.every(c => !c.findingRef && (c.origin === "operator" && !c.routeEvidence || c.origin === "discovery" && c.kind === "route" && c.routeEvidence?.commitId === impact.provenance.source.head))));
  const source = transformationSource(impact, p.proposalId, p.targets.map(t => t.document));
  for (const auth of p.authorizations) {
    const result = p.results.find(r => r.decisionId === auth.decisionId);
    assert(!!result); if (!result) continue;
    const baseline = p.targets.find(t => t.document.id === result.decision.documentId)?.document;
    assert(isDeepStrictEqual(auth, authorizeTransformation(impact, p.plan, result, baseline, source, auth.associations)));
  }
  const allUnits: ReturnType<typeof transformationSupportUnits> = [];
  for (const [index, result] of p.results.entries()) {
    assert(result.decisionId === `decision-${index + 1}` && isDeepStrictEqual(result.decision, p.plan.decisions[index]));
    const actionable = result.decision.action === "revise" || result.decision.action === "add";
    const baseline = p.targets.find(t => t.document.id === result.decision.documentId)?.document;
    if (actionable) assert(result.generation !== "not-required" && result.generation !== "pending" && result.support !== "pending");
    try { validateImpactDecisions(impact, [result.decision], p.targets.map(t => t.document)); }
    catch { assert(!result.reviewReady && !result.change && result.generation !== "generated"); }
    if (!actionable) assert(["not-required", "incomplete", "failed"].includes(result.generation) && result.support === "not-required" && !result.change && !result.reviewReady && !result.saveCompatible && ["not-applicable", "blocked"].includes(result.materialization));
    const auth = p.authorizations.find(a => a.decisionId === result.decisionId);
    if (result.change) {
      assert(!!auth); if (!auth) continue;
      validateTransformationEntry({ decisionId: result.decisionId, target: auth.target, change: result.change }, auth, baseline);
      if (result.change.kind !== "incomplete") {
        assert(result.generation === "generated");
        const units = transformationSupportUnits(auth, result.change, baseline); allUnits.push(...units);
        const checks = units.map(unit => p.supportChecks.filter(c => c.unitId === unit.id && c.decisionId === result.decisionId));
        if (["supported", "unsupported", "uncertain"].includes(result.support)) {
          assert(p.supportAttempted && !!p.supportModel && checks.every(c => c.length === 1));
          const verdict = checks.some(c => c[0]?.verdict === "unsupported") ? "unsupported" : checks.some(c => c[0]?.verdict === "uncertain") ? "uncertain" : "supported";
          assert(result.support === verdict);
        }
      }
    }
    assert(result.reviewReady === (result.generation === "generated" && result.support === "supported"));
    assert(!result.reviewReady || (result.generation === "generated" && result.support === "supported" && !!result.change && !!result.model));
    assert(!result.saveCompatible || (result.reviewReady && result.materialization === "ready" && !!result.candidateId));
    assert((result.materialization === "ready") === !!result.candidateId);
  }
  assert(new Set(p.supportChecks.map(c => c.unitId)).size === p.supportChecks.length);
  assert(p.supportChecks.every(c => allUnits.some(u => u.id === c.unitId && u.decisionId === c.decisionId)));
  const candidateDecisions = new Set<string>();
  for (const candidate of p.candidates) {
    const results = candidate.decisionIds.map(id => p.results.find(r => r.decisionId === id)!);
    assert(results.every(Boolean) && new Set(candidate.decisionIds).size === candidate.decisionIds.length);
    for (const r of results) { assert(!candidateDecisions.has(r.decisionId) && r.candidateId === candidate.document.id && r.saveCompatible); candidateDecisions.add(r.decisionId); }
    assert(results.every(r => r.decision.documentId === results[0].decision.documentId));
    assert(isDeepStrictEqual(candidate.decisionIds, p.results.filter(r => candidate.decisionIds.includes(r.decisionId)).map(r => r.decisionId)));
    const baseline = p.targets.find(t => t.document.id === results[0].decision.documentId)?.document;
    const rebuilt = assembleDocumentationChange({ proposalId: p.proposalId, createdAt: p.createdAt, planSha256: p.planSha256,
      baseline, results, source, suppliedContext: proposalOperatorContext(p, results), limitations: [...new Set(results.flatMap(r => r.limitations))] });
    assert(isDeepStrictEqual(validateDocumentationDocument(candidate.document), rebuilt));
  }
  assert(p.results.every(r => !r.candidateId || candidateDecisions.has(r.decisionId)));
  const complete = p.results.filter(r => r.issues.length === 0 && (r.generation === "not-required" || r.materialization === "ready")).length;
  const status = complete === p.results.length && !p.protocolIssues.length ? "complete" : complete > 0 || p.results.some(r => r.generation === "generated") ? "partial" : "failed";
  assert(p.status === status);
  return p;
}
