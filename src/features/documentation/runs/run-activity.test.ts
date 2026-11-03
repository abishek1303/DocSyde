import assert from "node:assert/strict";
import { test } from "node:test";
import { activitySubsteps } from "./run-activity";
import type { RunView } from "./run-record";
import type { RunInvocationSummary } from "./run-invocation-summary";
const stage = (key: string, status = "running") => ({ key, status, summary: "", startedAt: null, finishedAt: null }) as RunView["stages"][number];
const call = (stage: string, operation: string, status: string, failureKind: string | null = null): RunInvocationSummary => ({ id: "fixture", stage, operation, status, provider: "baseten", model: null, failureKind, completionReason: null, inputTokens: null, outputTokens: null, elapsedMs: null, createdAt: "2026-11-02T00:00:00Z" });
test("source substeps follow inference and authoritative validation boundaries", () => {
  assert.deepEqual(activitySubsteps(stage("source-analysis"), []).map(s => s.status), ["running", "waiting", "waiting"]);
  for (const [status, expected] of [["started", ["completed", "running", "waiting"]], ["structured-success", ["completed", "completed", "running"]], ["succeeded", ["completed", "completed", "completed"]]] as const) {
    assert.deepEqual(activitySubsteps(stage("source-analysis"), [call("source-analysis", "source-analysis", status)]).map(s => s.status), expected);
  }
  const failed = call("source-analysis", "source-analysis", "failed", "grounding-rejection");
  assert.equal(activitySubsteps(stage("source-analysis", "failed"), [failed])[2].status, "failed");
});
test("support checking is not presented as complete just because generation finished", () => {
  const generation = call("documentation-transformation", "documentation-transformation", "succeeded");
  assert.deepEqual(activitySubsteps(stage("documentation-transformation"), [generation]).map(s => s.status), ["completed", "waiting"]);
  const support = call("documentation-transformation", "transformation-support", "started");
  assert.deepEqual(activitySubsteps(stage("documentation-transformation"), [generation, support]).map(s => s.status), ["completed", "running"]);
  assert.deepEqual(activitySubsteps(stage("documentation-planning"), [call("documentation-planning", "documentation-planning", "started")]).map(s => s.status), ["completed", "running"]);
});
