import { test } from "node:test";
import assert from "node:assert/strict";
import { runRuntimeConfigSchema } from "@/features/documentation/runs/run-runtime-config";
import { scenarioWorkflow, scenarios } from "./workflows";
import { documentationHash } from "@/features/documentation/documents/document-identity";

test("scenario capabilities are isolated, bounded and deterministically tied to workflows", () => {
  const hashes = new Set<string>();
  for (const scenario of scenarios) {
    const config = runRuntimeConfigSchema.parse(scenarioWorkflow(scenario));
    assert.equal(config.capabilities.length, 1);
    assert.equal(config.maxSelectedScreenshots, 1);
    assert.ok(config.supportedPathnames.includes(config.capabilities[0].pathname));
    assert.equal(config.workflow.limits.timeoutMs, 120_000);
    assert.equal(documentationHash(config), documentationHash(runRuntimeConfigSchema.parse(scenarioWorkflow(scenario))));
    hashes.add(documentationHash(config));
  }
  assert.equal(hashes.size, 3);
});
test("A explicitly selects priority; B checkpoints confirmation; C never changes domain state", () => {
  assert.ok(scenarioWorkflow("A").workflow.steps?.some(step => step.type === "select" && step.selector === "#priority"));
  const steps = scenarioWorkflow("B").workflow.steps!;
  const checkpoint = steps.findIndex(step => step.type === "checkpoint");
  assert.ok(checkpoint > 0);
  assert.ok(steps.slice(0, checkpoint).some(step => step.type === "click" && step.selector === "#close-request"));
  assert.ok(steps.slice(checkpoint).some(step => step.type === "click" && step.selector === "#cancel-close"));
  assert.ok(scenarioWorkflow("C").workflow.steps?.every(step => step.type === "checkpoint" || step.type === "waitFor" || (step.type === "click" && step.selector === 'a[href="/requests/r-002"]')));
});
