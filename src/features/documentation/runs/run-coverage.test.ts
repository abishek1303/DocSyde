import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { finishRetainedRun } from "./run-checkpoints";
import { runRecordV2 } from "./run-record";
import { initialWorkflowStages } from "./run-workflow-state";
import { transformationImpactFixture, transformationPlanFixture, transformationDecisionFixture } from "../../../../infra/local/documentation/transformation-fixtures";

for (const ready of [0, 1, 4]) test(`retention reports ${ready} of 4 ready without changing dispositions`, () => {
  const impact = transformationImpactFixture(), source = impact.provenance.source;
  const record = runRecordV2.parse({ schemaVersion: 2, input: { owner: "abishek1303", repo: "DocSyde", base: source.base, head: source.head, paths: [], associations: [], runContext: null },
    title: "Documentation", status: "running", disposition: null, activeStage: "proposal-retention", reason: null, summary: "Running", startedAt: new Date().toISOString(), finishedAt: null,
    execution: { token: randomUUID(), heartbeatAt: new Date().toISOString(), cancelRequestedAt: null }, stages: initialWorkflowStages(), impact,
    plan: transformationPlanFixture(impact, Array.from({ length: 4 }, () => transformationDecisionFixture(null, null, "add"))),
  });
  const finished = finishRetainedRun(record, { proposalId: randomUUID(), proposalHash: "a".repeat(64), registeredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() },
    { actionableDecisionIds: Array.from({ length: ready }, (_, i) => `decision-${i + 1}`), coverageGaps: ready < 4 ? ["Unaccepted updates remain"] : [] });
  assert.equal(finished.disposition, ready ? "awaiting-review" : "incomplete");
  assert.equal(finished.reason, ready ? "proposal-retained-awaiting-human-review" : "proposal-no-publishable-updates");
  if (ready) assert.match(finished.summary, new RegExp(`${ready} of 4`));
  assert.equal(finished.summary.includes("Partial coverage"), ready > 0 && ready < 4);
});

test("risk counts distinguish warnings from verified support and failed guides", async () => {
  const { riskCounts } = await import("../transformation/grounding-risk");
  assert.deepEqual(riskCounts([
    { generation: "generated", reviewReady: true, reviewOutcome: "ready" },
    { generation: "generated", reviewReady: true, reviewOutcome: "warnings" },
    { generation: "generated", reviewReady: false, reviewOutcome: "blocked" },
    { generation: "failed", reviewReady: false },
    { generation: "not-required", reviewReady: false },
  ]), { ready: 1, warnings: 1, blocked: 2 });
});
