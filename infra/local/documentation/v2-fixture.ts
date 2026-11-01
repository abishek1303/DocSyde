// Canonical transformation fixture only; no provider or persistence calls.
import { randomUUID } from "node:crypto";
import { draftFixture } from "./draft-fixture";
import { transformationImpactFixture, transformationPlanFixture, transformationDecisionFixture, transformationEntryFixture } from "./transformation-fixtures";
import { documentationHash } from "@/features/documentation/documents/document-identity";
import { assembleDocumentationChange } from "@/features/documentation/transformation/assemble-documentation-change";
import { transformationSource, authorizeTransformation } from "@/features/documentation/transformation/transformation-input";
import type { DecisionResult } from "@/features/documentation/transformation/documentation-change-proposal";
import type { DocumentationDocument } from "@/features/documentation/documents/document";

export function v2CandidateFixture(baseline: DocumentationDocument = draftFixture()) {
  const proposalId = randomUUID(), impact = transformationImpactFixture(), decision = transformationDecisionFixture(baseline.id, baseline.sections[0].id);
  impact.provenance.source.repository = baseline.provenance.repository;
  const plan = transformationPlanFixture(impact, [decision]);
  const result: DecisionResult = { decisionId: "decision-1", decision, generation: "generated", support: "supported", reviewReady: true,
    materialization: "pending", saveCompatible: false, approval: "not-requested", issues: [], limitations: [], change: null,
    model: { model: "fixture", elapsedMs: 1 }, candidateId: null };
  const source = transformationSource(impact, proposalId, [baseline]);
  const auth = authorizeTransformation(impact, plan, result, baseline, source, []);
  result.change = transformationEntryFixture(auth, []).change;
  const document = assembleDocumentationChange({ proposalId, createdAt: "2026-10-30T00:00:00.000Z", planSha256: documentationHash(plan), baseline,
    results: [result], source, suppliedContext: [], limitations: [] });
  return { document, baseline, source, result, impact, plan, proposalId };
}
