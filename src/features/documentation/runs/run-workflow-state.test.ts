import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runRecord, runRecordV2 } from "./run-record";
import { initialStages } from "../drafts/run-progress";
import { changeWorkflowStage, initialWorkflowStages, WORKFLOW_STEPS, RUN_HEARTBEAT_MS, RUN_CONTROL_MS, RUN_STALE_MS, RUN_HEARTBEAT_FAILURE_MS, RUN_RECONCILE_MS, RUN_DEADLINE_MS } from "./run-workflow-state";

const input = { owner: "example", repo: "project", base: "a".repeat(40), head: "b".repeat(40), paths: [], associations: [], runContext: null };
function pending() { return { schemaVersion: 2, input, title: "Change", status: "pending", disposition: null, activeStage: null, reason: null, summary: "Ready", startedAt: null, finishedAt: null, execution: null, stages: initialWorkflowStages(), artifacts: [], models: [], warnings: [] }; }
test("versioned payload validates lifecycle, stage order and authority; legacy rows remain readable", () => {
  assert.equal(runRecordV2.parse(pending()).status, "pending");
  const legacy = { input, title: "Old change", status: "completed", startedAt: null, finishedAt: null, summary: "Old draft", stages: initialStages(), result: { status: "no-draft", document: null } };
  assert.ok(!("schemaVersion" in runRecord.parse(legacy)));
  assert.equal(runRecord.safeParse({ ...pending(), schemaVersion: 3 }).success, false);
  assert.equal(runRecord.safeParse({ ...pending(), status: "running" }).success, false);
  assert.equal(runRecord.safeParse({ ...pending(), status: "finished", disposition: "awaiting-review", finishedAt: new Date().toISOString() }).success, false);
  assert.equal(runRecord.safeParse({ ...pending(), stages: initialWorkflowStages().reverse() }).success, false);
  assert.equal(runRecord.safeParse({ ...pending(), candidates: [] }).success, false);
});
test("stages enforce order while permitting explicit conditional skips", () => {
  let stages = initialWorkflowStages();
  assert.throws(() => changeWorkflowStage(stages, "source-analysis", "running", "Wrong order"));
  assert.throws(() => changeWorkflowStage(stages, "prepare-context", "completed", "Not started"));
  for (const key of WORKFLOW_STEPS) {
    if (key === "runtime-inspection") stages = changeWorkflowStage(stages, key, "skipped", "Runtime unavailable; no trusted workflow");
    else { stages = changeWorkflowStage(stages, key, "running", key); stages = changeWorkflowStage(stages, key, "completed", key); }
  }
  assert.equal(stages[3].summary, "Runtime unavailable; no trusted workflow");
  assert.ok(stages.every(s => s.finishedAt));
});
test("execution policy is bounded and has no review/apply/draft-generation dependency", async () => {
  assert.deepEqual([RUN_HEARTBEAT_MS, RUN_CONTROL_MS, RUN_STALE_MS, RUN_HEARTBEAT_FAILURE_MS, RUN_RECONCILE_MS], [10000, 2000, 60000, 30000, 15000]);
  assert.equal(RUN_DEADLINE_MS, 2400000);
  const workflow = await readFile(new URL("./execute-run-workflow.ts", import.meta.url), "utf8");
  assert.ok(!/applyDocumentationReview|saveDraftPreview|createDraftFromChanges|publishDocumentation|executeRuntimeInspection/.test(workflow));
  assert.equal((workflow.match(/await synthesizeProductImpact\(/g) ?? []).length, 1);
  assert.equal((workflow.match(/await planDocumentationImpact\(/g) ?? []).length, 1);
});
