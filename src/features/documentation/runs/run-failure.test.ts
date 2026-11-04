import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { SourceReadError } from "@/integrations/github/errors";
import { ModelError } from "@/integrations/ai/structured-output";
import { ProductEvidenceBudgetError } from "@/features/sources/product-analysis";
import { classifyRunFailure, modelFailureCode } from "./classify-run-failure";
import { runFailureDescription, runFailureForView } from "./run-failure";
import { finishRun } from "./run-checkpoints";
import { runRecordV2 } from "./run-record";
import { runView } from "./run-operations";
import { changeWorkflowStage, initialWorkflowStages } from "./run-workflow-state";

test("failure classification maps trusted error codes to fixed public explanations", () => {
  const secret = "Bearer private-token postgres://user:password@host/db source-body";
  for (const [error, expected] of [
    [new SourceReadError("missing-credentials", secret), "source-credentials"],
    [new SourceReadError("unauthorized", secret), "source-access"],
    [new SourceReadError("incomplete-evidence", secret), "source-incomplete"],
    [new SourceReadError("unsupported-comparison", secret), "source-history"],
    [new ModelError("billing"), "model-billing"],
    [new ModelError("invalid-json"), "model-output"],
    [new ModelError(secret), "model-failed"],
    [new ModelError("__proto__"), "model-failed"],
    [new ProductEvidenceBudgetError(), "evidence-budget"],
    [new ZodError([]), "invalid-data"],
    [new Error(secret), "stage-failed"],
  ] as const) {
    const failure = classifyRunFailure("source-analysis", error);
    assert.equal(failure.code, expected);
    const serialized = JSON.stringify({ failure, ...runFailureDescription(failure.code) });
    assert.ok(!serialized.includes(secret));
    assert.ok(!serialized.includes("private-token"));
    assert.ok(!serialized.includes("password"));
  }
  assert.equal(modelFailureCode("toString"), "model-failed");
  assert.equal(classifyRunFailure("runtime-inspection", new Error(secret)).code, "runtime-failed");
  const database = new Error(secret, { cause: Object.assign(new Error(secret), { code: "42P01" }) });
  assert.equal(classifyRunFailure("proposal-retention", database).code, "database-schema");
  assert.equal(classifyRunFailure("source-analysis", database).code, "stage-failed");
});

test("finishing a failed stage retains safe detail through persistence validation and status projection", () => {
  let stages = changeWorkflowStage(initialWorkflowStages(), "prepare-context", "running", "Preparing");
  stages = changeWorkflowStage(stages, "prepare-context", "completed", "Ready");
  stages = changeWorkflowStage(stages, "source-analysis", "running", "Reading");
  const running = runRecordV2.parse({ schemaVersion: 2, input: { owner: "example", repo: "product", branch: "main", base: "a".repeat(40), head: "b".repeat(40), paths: [] }, title: "Change", status: "running", disposition: null, reason: null, activeStage: "source-analysis", summary: "Running", startedAt: new Date().toISOString(), finishedAt: null, stages, execution: { token: randomUUID(), heartbeatAt: new Date().toISOString(), cancelRequestedAt: null } });
  const failure = classifyRunFailure("source-analysis", new SourceReadError("incomplete-evidence", "private provider response"));
  assert.equal(runRecordV2.safeParse({ ...running, failure }).success, false);
  const record = finishRun(running, "failed", "stage-failed:source-analysis", failure);
  assert.equal(record.reason, "stage-failed:source-analysis");
  assert.equal(record.stages[0].status, "completed");
  assert.equal(record.stages[1].status, "failed");
  assert.equal(record.stages[1].summary, runFailureDescription(failure.code).message);
  assert.ok(record.stages.slice(2).every(stage => stage.status === "skipped"));
  assert.ok(!JSON.stringify(record).includes("private provider response"));
  const view = runView({ id: randomUUID(), createdAt: new Date().toISOString(), record, savedAt: null });
  assert.deepEqual(view.failure, failure);
  assert.equal(view.summary, runFailureDescription(failure.code).message);
  assert.equal(runRecordV2.safeParse({ ...record, failure: { ...failure, code: "raw-provider-message" } }).success, false);
  const { failure: ignored, ...historical } = record;
  void ignored;
  assert.equal(runRecordV2.safeParse(historical).success, true);
  const oldView = runView({ id: randomUUID(), createdAt: new Date().toISOString(), record: historical, savedAt: null });
  assert.equal(runFailureForView(oldView)?.code, "details-unavailable");
  assert.equal(runFailureForView({ status: "running", stages: [] }), undefined);
});

test("candidate ambiguity remains incomplete with bounded diagnostics in the saved run",()=>{
 const id=randomUUID(),now=new Date().toISOString();
 const running=runRecordV2.parse({schemaVersion:2,input:{owner:"example",repo:"product",base:"a".repeat(40),head:"b".repeat(40),paths:[]},title:"Change",status:"running",disposition:null,reason:null,activeStage:"documentation-planning",summary:"Planning",startedAt:now,finishedAt:null,stages:initialWorkflowStages(),execution:{token:randomUUID(),heartbeatAt:now,cancelRequestedAt:null}});
 const diagnostics={outcome:"ambiguous" as const,scannedSections:44,scannedDocuments:11,retainedSections:0,retainedDocuments:0,supportedDocuments:11};
 const finished=finishRun(running,"incomplete","documentation-candidates-incomplete",{stage:"documentation-planning",code:"candidates-incomplete",candidateSelection:diagnostics});
 assert.equal(finished.disposition,"incomplete");assert.deepEqual(finished.failure?.candidateSelection,diagnostics);
 assert.deepEqual(runView({id,record:finished,createdAt:now,savedAt:null}).failure?.candidateSelection,diagnostics);
 assert.ok(!runRecordV2.safeParse({...finished,failure:{...finished.failure,candidateSelection:{...diagnostics,rawSource:"PRIVATE"}}}).success);
});
