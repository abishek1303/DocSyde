// Controlled publication fixture based on the demo's Blocked guidance semantics.
// No source-analysis/model result is claimed by this test producer.
import { randomUUID } from "node:crypto";
import { draftFixture } from "../documentation/draft-fixture";
import { transformationImpactFixture, transformationPlanFixture, transformationDecisionFixture, transformationEntryFixture } from "../documentation/transformation-fixtures";
import { transformationSource, authorizeTransformation } from "@/features/documentation/transformation/transformation-input";
import { transformationSupportUnits, validateTransformationEntry } from "@/features/documentation/transformation/transformation-validation";
import { assembleDocumentationChange } from "@/features/documentation/transformation/assemble-documentation-change";
import { validateDocumentationProposal } from "@/features/documentation/transformation/validate-documentation-proposal";
import { documentationHash } from "@/features/documentation/documents/document-identity";
import type { DocumentationChangeProposal, DecisionResult } from "@/features/documentation/transformation/documentation-change-proposal";

export const blockedGuidance = "Work remains paused while an issue is Blocked. Manually change its status when work can continue. Issues do not unblock automatically.";
export function blockedFixture(repository: string) {
  const baseline = draftFixture(); baseline.provenance.repository = repository; baseline.title = "Issue Management";
  baseline.context[0].value = "/issues/detail"; baseline.context[1].value = "Issue detail";
  baseline.sections = [baseline.sections[0]]; baseline.sections[0].title = "Issue status";
  baseline.sections[0].content = [{ markdown: "Use issue status to track work.", factRefs: ["fact-after"] }];
  baseline.provenance.facts[0].value = "Use issue status to track work.";
  baseline.provenance.findings[0].after = "Use issue status to track work.";
  baseline.provenance.findings[0].description = "An issue status tracks work.";
  baseline.provenance.findings[0].citations[0].excerpt = "Test fixture: issue status tracks work.";
  baseline.provenance.limitations = ["Controlled MCP fixture; not an inferred or reverified source result."];
  const impact = transformationImpactFixture(); impact.provenance.source.repository = repository;
  impact.claims[0].description = "Conditional Blocked guidance explains manual resumption.";
  impact.claims[0].before = "Use issue status to track work."; impact.claims[0].after = blockedGuidance;
  const finding = impact.provenance.sourceReferences[0].finding;
  finding.kind = "product-behavior"; finding.description = impact.claims[0].description;
  finding.before = impact.claims[0].before; finding.after = blockedGuidance;
  finding.citations[0].excerpt = `+${blockedGuidance}`;
  const plan = transformationPlanFixture(impact, [transformationDecisionFixture(baseline.id, baseline.sections[0].id)]);
  plan.decisions[0].updateIntent = "Explain Blocked guidance and manual resumption.";
  const proposalId = randomUUID(), createdAt = new Date().toISOString(), planSha256 = documentationHash(plan);
  const result: DecisionResult = { decisionId: "decision-1", decision: plan.decisions[0], generation: "generated", support: "supported", reviewReady: true,
    materialization: "ready", approval: "not-requested", saveCompatible: true, issues: [], limitations: [], change: null, model: { model: "controlled-fixture-no-inference", elapsedMs: 0 }, candidateId: null };
  const source = transformationSource(impact, proposalId, [baseline]), auth = authorizeTransformation(impact, plan, result, baseline, source, []);
  const entry = transformationEntryFixture(auth, []);
  if (entry.change.kind !== "replace-section") throw new Error("Expected fixture section update.");
  entry.change.section.title = "Blocked issues"; entry.change.section.content[0].markdown = blockedGuidance;
  result.change = validateTransformationEntry(entry, auth, baseline);
  const document = assembleDocumentationChange({ proposalId, createdAt, planSha256, baseline, results: [result], source, suppliedContext: [], limitations: [] });
  result.candidateId = document.id;
  const proposal: DocumentationChangeProposal = { proposalId, createdAt, impactSha256: documentationHash(impact), planSha256, status: "complete", impact, plan,
    targets: [{ identity: { documentId: baseline.id, sha256: documentationHash(baseline) }, document: baseline }], authorizations: [auth], results: [result],
    candidates: [{ decisionIds: [result.decisionId], document }], batches: [{ decisionIds: [result.decisionId], requestBytes: 1, status: "completed", model: result.model }],
    supportAttempted: true, supportModel: { model: "controlled-fixture-no-inference", elapsedMs: 0 }, protocolIssues: [],
    supportChecks: transformationSupportUnits(auth, result.change, baseline).map(unit => ({ unitId: unit.id, decisionId: result.decisionId, verdict: "supported", reason: "Controlled test fixture." })) };
  return { baseline, proposal: validateDocumentationProposal(proposal) };
}
