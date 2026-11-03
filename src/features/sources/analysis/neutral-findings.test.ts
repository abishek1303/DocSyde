import assert from "node:assert/strict";
import { test } from "node:test";
import fixture from "./fixtures/blocked-guidance.json";
import { productChangeGenerationOutput, type ProductBundle } from "./product-change-analysis";
import { reconstructProductAnalysis, serializeProductEvidence } from "./product-change-evidence";
import { storedProductResult } from "./stored-product-result";
import { allowedImpactClaims } from "../impact/impact-claim-support";

const bundle = fixture.bundle as ProductBundle;
function neutralOutput() {
  return { uncertainties: fixture.output.uncertainties, findings: fixture.output.findings.map(({ reachabilityEvidenceIds: _legacyReachability, ...finding }) => {
    assert.ok(Array.isArray(_legacyReachability));
    return ({
    ...finding, kind: "product-behavior", citations: finding.citations.map(({ evidenceId, startLine, endLine }) => ({ evidenceId, startLine, endLine })),
  });
  }) };
}
test("persisted misclassified Blocked guidance becomes a neutral grounded finding without changing source facts", () => {
  assert.equal(fixture.output.findings[0].kind, "behavior-removed");
  const output = productChangeGenerationOutput.parse(neutralOutput());
  const canonical = reconstructProductAnalysis(output, bundle);
  assert.equal(canonical.assessment, "product-change");
  assert.equal(canonical.findings[0].kind, "product-behavior");
  for (const field of ["description", "before", "after", "citations", "uncertainties"] as const) {
    assert.deepEqual(canonical.findings[0][field], fixture.output.findings[0][field]);
  }
  assert.deepEqual(allowedImpactClaims(canonical.findings[0].kind), ["behavior-change", "workflow-change", "ui-change"]);
  const historical = storedProductResult.parse({ bundle, bytes: 0, status: "analyzed", analysis: fixture.output });
  assert.deepEqual(historical.analysis, fixture.output);
});

test("advisory context never creates reference authority for neutral findings", () => {
  const output = neutralOutput();
  output.findings[0].citations[0].evidenceId = "runContext";
  assert.throws(() => reconstructProductAnalysis(output, bundle), /unknown-evidence/);
  const serialized = JSON.parse(serializeProductEvidence(bundle, { repositoryContextUsed: "Advisory", runContextUsed: "Advisory" }));
  assert.equal(serialized.repositoryContext, "Advisory");
  assert.deepEqual(serialized.evidence.map((entry: { evidenceId: string }) => entry.evidenceId), ["patch-f1"]);
});
