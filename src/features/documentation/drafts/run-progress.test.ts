import { test } from "node:test";
import assert from "node:assert/strict";
import { initialStages, advanceStage, finishStages, RUN_STEPS } from "./run-progress";
const now = "2026-10-30T12:00:00.000Z";
test("run steps only advance in execution order", () => {
  let stages = initialStages();
  assert.throws(() => advanceStage(stages, { step: "understand-impact", status: "running", summary: "" }, now));
  for (const step of RUN_STEPS) {
    stages = advanceStage(stages, { step: step.key, status: "running", summary: "Started" }, now);
    stages = advanceStage(stages, { step: step.key, status: "completed", summary: "Complete" }, now);
  }
  assert.ok(stages.every(stage => stage.status === "completed"));
});
test("failed and unnecessary steps are explicit", () => {
  let stages = advanceStage(initialStages(), { step: "prepare-context", status: "running", summary: "Started" }, now);
  stages = finishStages(stages, true, "Failed", now);
  assert.equal(stages[0].status, "failed");
  assert.ok(stages.slice(1).every(stage => stage.status === "skipped"));
  const skipped = finishStages(initialStages(), false, "No change", now);
  assert.ok(skipped.every(stage => stage.status === "skipped"));
});
