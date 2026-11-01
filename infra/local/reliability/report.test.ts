import { test } from "node:test";
import assert from "node:assert/strict";
import { comparisonMarkdown } from "./report";

test("comparison preserves missing usage, scope exclusions, zero images and operation-level evidence", () => {
  const markdown = comparisonMarkdown([{ experimentId: "test", comparisonIdentity: { specificationVersion: 2, docsydeSha: "sha", requestDeskBase: "base", contractConfigSha256: "0".repeat(64), runtimePolicySha256: "0".repeat(64), corpusSha256: "0".repeat(64), baselineSha256: "0".repeat(64) }, scenario: "A", semanticType: "field-default", outcome: "outside-single-batch-scope",
    sourceAssessment: "product-change", runtimeDecision: "not-needed", capabilitySelected: [], selectedImageCount: 0,
    firstFailingStage: null, base: "base", docsydeSha: "sha", frozenInference: {}, publication: null,
    invocations: [{ operation: "source-analysis", inputTokens: null, outputTokens: 42, completionReason: "length", elapsedMs: 12,
      status: "failed", failureKind: "incomplete-output", inferenceConfig: { temperature: null }, requestOmissionReason: "not-allowlisted", responseOmissionReason: "model-failure" }] }]);
  assert.match(markdown, /outside-single-batch-scope/); assert.match(markdown, /unavailable \| 42 \| length/);
  assert.match(markdown, /\[\] \| 0 \| source-analysis/); assert.match(markdown, /not-allowlisted/);
  assert.match(markdown, /do not establish causality/);
});
