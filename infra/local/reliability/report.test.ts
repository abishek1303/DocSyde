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

test("image counts accept v3 schema-valid snapshots/results and historical v2 without counting failed selection", async () => {
  const { selectedImageCount } = await import("./report");
  const { debugOutput } = await import("@/integrations/ai/invocation-debug");
  const item = { checkpointId: "00000000-0000-4000-8000-000000000001", sourceRefs: ["source-1"], question: "What is visible?" };
  const count = (payload: unknown, status = "succeeded") => selectedImageCount([{ operation: "visual-selection", status, responsePayload: payload }], "completed");
  assert.equal(count(debugOutput("visual-selection", { selected: [item] })), 1);
  assert.equal(count(debugOutput("visual-selection", { selected: [] })), 0);
  assert.equal(count({ version: 3, selected: [item] }), 1);
  assert.equal(count({ decision: "analyze", selected: [{ checkpointId: item.checkpointId, sourceRefs: item.sourceRefs }] }), 1);
  assert.equal(count({ decision: "analyze", reason: "Historical", selected: [{ ...item, reason: "Historical" }], uncertainties: [] }), 1);
  assert.equal(count(debugOutput("visual-selection", { selected: [item] }), "failed"), null);
  assert.equal(count(debugOutput("visual-selection", { selected: [item], extra: "unsafe" })), null);
  const truncated = debugOutput("visual-selection", { selected: [item] })!; truncated.output.truncated = true;
  assert.equal(count(truncated), null);
  assert.equal(count("malformed"), null);
  assert.equal(selectedImageCount([], "not-needed"), 0);
});
