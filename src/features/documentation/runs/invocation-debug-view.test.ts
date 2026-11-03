import { test } from "node:test";
import assert from "node:assert/strict";
import { invocationDebugView } from "./invocation-debug-view";

test("validation details remain readable alongside provider timing metadata", () => {
  const view = invocationDebugView({ operation: "source-analysis", status: "failed", failureKind: "grounding-rejection",
    diagnostic: { kind: "grounding-rejection", validator: "source-analysis", code: "unqualified-inference", path: "findings[0]", model: "fixture-model", elapsedMs: 10, usage: { inputTokens: 12 } } });
  assert.equal(view.diagnostic?.code, "unqualified-inference");
  assert.equal(view.diagnostic?.path, "findings[0]");
  assert.equal(view.diagnosticMessage, "An inferred finding must disclose its assumptions or uncertainties.");
  assert.ok(!("usage" in view.diagnostic!));
});
