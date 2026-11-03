import React from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RunMonitor } from "./run-monitor";
import type { RunView } from "../../runs/run-record";
import { initialWorkflowStages } from "../../runs/run-workflow-state";

function fixture(): RunView {
  return { id: "run-fixture", schemaVersion: 2, input: { owner: "example", repo: "product", base: "a".repeat(40), head: "b".repeat(40), paths: [], associations: [], runContext: null }, title: "Prepare documentation", status: "running", summary: "Running", createdAt: "2026-11-01T00:00:00Z", startedAt: null, finishedAt: null, savedAt: null, documentId: null, hasDraft: false, hasEvidence: true, stages: initialWorkflowStages() };
}
test("activity renders output inline beneath its own stage and exposes logs near the header", () => {
  const run = fixture(); run.stages[1].status = "completed";
  run.responses = [{ stage: "source-analysis", kind: "ai", status: "available", preview: "Current source finding", message: "View source" }];
  const html = renderToStaticMarkup(<RunMonitor initial={run} />);
  assert.ok(html.indexOf("Understanding the code change") < html.indexOf("Current source finding"));
  assert.ok(html.indexOf("Current source finding") < html.indexOf("Deciding what to inspect"));
  assert.ok(html.indexOf("AI activity / Logs") < html.indexOf("Execution timeline"));
  assert.ok(!html.includes("stage-output"));
});
test("skipped runtime has an explanation and no screenshot placeholder", () => {
  const run = fixture(); run.stages[3].status = "skipped";
  const html = renderToStaticMarkup(<RunMonitor initial={run} />);
  assert.match(html, /Runtime inspection was skipped/);
  assert.ok(!html.includes("Browser screenshots will appear"));
  assert.ok(!html.includes("Loading runtime inspection"));
});
test("support rejection explains the outcome and cannot show a successful stage or review CTA", () => {
  const run = fixture(); run.status = "incomplete"; run.reason = "transformation-not-review-ready";
  run.outputs = { supportRejected: true, models: [] };
  run.stages[6].status = "completed"; // Historical records used to mark this complete.
  const html = renderToStaticMarkup(<RunMonitor initial={run} />);
  assert.match(html, /some generated statements weren&#x27;t supported/);
  assert.match(html, /Stopped at: Preparing documentation updates/);
  assert.match(html, /Not accepted/);
  assert.match(html, /No review-ready proposal is available/);
  assert.ok(!html.includes(">Review changes<"));
});
test("successful runs open the originating proposal in Pending Changes", () => {
  const run = fixture(); run.status = "awaiting-review";
  run.retainedProposal = { proposalId: "proposal-fixture", proposalHash: "a".repeat(64), registeredAt: "2026-11-01T00:00:00Z", expiresAt: "2026-11-02T00:00:00Z" };
  const html = renderToStaticMarkup(<RunMonitor initial={run} />);
  assert.match(html, /Review changes/);
  assert.match(html, /\/docs\?repository=example%2Fproduct&amp;tab=pending&amp;proposal=proposal-fixture/);
});
