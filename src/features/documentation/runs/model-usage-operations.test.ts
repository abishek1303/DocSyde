import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createRequire } from "node:module";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runRecordV2 } from "./run-record";
import { initialWorkflowStages } from "./run-workflow-state";
import { assertAllowedRepository } from "@/features/sources/product-analysis";

const load = createRequire(join(process.cwd(), "package.json"));
const persistencePath = load.resolve("./src/integrations/database/ai-model-invocations.ts");
const runPath = load.resolve("./src/features/documentation/runs/run-operations.ts");
const operationsPath = load.resolve("./src/features/documentation/runs/model-usage-operations.ts");
const persistence: typeof import("@/integrations/database/ai-model-invocations") = load(persistencePath);
const runs: typeof import("./run-operations") = load(runPath);

function setup(t: TestContext) {
  const previous = process.env.DOCSYDE_ANALYSIS_REPOSITORIES;
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "example/product";
  const now = new Date(), runId = randomUUID(), id = randomUUID();
  const record = runRecordV2.parse({ schemaVersion: 2, input: { owner: "example", repo: "product", base: "a".repeat(40), head: "b".repeat(40), paths: [] }, title: "Fixture", status: "finished", disposition: "failed", activeStage: null, reason: "fixture", summary: "Failed", startedAt: now.toISOString(), finishedAt: now.toISOString(), execution: null,
    stages: initialWorkflowStages(), failure: { stage: "source-analysis", code: "model-output", diagnostic: { kind: "incomplete-output", completionReason: "length" } } });
  const run = { id: runId, record, createdAt: now.toISOString(), savedAt: null };
  const row = { id, runId, stage: "source-analysis", operation: "source-analysis", provider: "baseten", model: "fixture", status: "failed", failureKind: "incomplete-output", completionReason: "length", inputTokens: null, outputTokens: 8192, elapsedMs: 100, createdAt: now, diagnostic: { kind: "incomplete-output", completionReason: "length", usage: { completion_tokens: 8192 } } };
  let listing = Array.from({ length: 101 }, () => row);
  let detail: typeof row | null = row;
  let readFails = false;
  const queries: unknown[][] = [];
  const dbModule = load.cache[persistencePath]!, runModule = load.cache[runPath]!;
  const originalDb = dbModule.exports, originalRun = runModule.exports, originalOperations = load.cache[operationsPath];
  dbModule.exports = { ...persistence,
    async selectRepositoryAiInvocations(...args: unknown[]) { queries.push(args); if (readFails) throw new Error("PRIVATE_DB_BODY"); return listing; },
    async findAiModelInvocation() { return detail; },
  };
  runModule.exports = { ...runs, async getDocumentationRun(rawId: string) {
    assertAllowedRepository(record.input.owner, record.input.repo);
    return rawId === runId ? run : null;
  } };
  delete load.cache[operationsPath];
  t.after(() => {
    dbModule.exports = originalDb; runModule.exports = originalRun;
    if (originalOperations) load.cache[operationsPath] = originalOperations; else delete load.cache[operationsPath];
    if (previous === undefined) delete process.env.DOCSYDE_ANALYSIS_REPOSITORIES; else process.env.DOCSYDE_ANALYSIS_REPOSITORIES = previous;
  });
  const operations: typeof import("./model-usage-operations") = load(operationsPath);
  return { ...operations, row, record, queries, setListing(value: typeof listing) { listing = value; }, setDetail(value: typeof detail) { detail = value; }, failReads() { readFails = true; } };
}

test("repository list is authorized, bounded, filtered, metadata-only and historically empty", async t => {
  const s = setup(t);
  const result = await s.listModelUsage({ repository: "example/product", runId: s.row.runId, stage: s.row.stage });
  assert.equal(result.invocations.length, 25); assert.equal(result.hasNextPage, true);
  assert.deepEqual(s.queries[0], ["https://github.com/example/product", s.row.runId, s.row.stage, { status: undefined, provider: undefined, limit: 26, offset: 0 }]);
  assert.equal(result.invocations[0].outputTokens, 8192);
  assert.equal("diagnostic" in result.invocations[0], false);
  await assert.rejects(s.listModelUsage({ repository: "other/private" }));
  assert.equal(s.queries.length, 1);
  s.setListing([]);
  assert.deepEqual((await s.listModelUsage({ repository: "example/product" })).invocations, []);
});

test("detail checks run access, rejects standalone rows and never returns invalid diagnostic objects", async t => {
  const s = setup(t);
  const result = await s.getModelUsage(s.row.id);
  assert.equal(result?.diagnostic?.completionReason, "length");
  assert.equal(result?.runId, s.row.runId);
  s.setDetail({ ...s.row, requestPayload: { input: "PRIVATE_REQUEST" }, responsePayload: { text: "PRIVATE_RESPONSE" }, inferenceConfig: { internal: "PRIVATE" } } as typeof s.row);
  const metadataOnly = await s.getModelUsage(s.row.id);
  assert.equal("requestPayload" in metadataOnly!, false); assert.equal("responsePayload" in metadataOnly!, false);
  assert.ok(!JSON.stringify(metadataOnly).includes("PRIVATE"));
  s.setDetail({ ...s.row, diagnostic: { ...s.row.diagnostic, credential: "PRIVATE_CREDENTIAL" } } as typeof s.row);
  assert.equal((await s.getModelUsage(s.row.id))?.diagnostic, null);
  s.setDetail({ ...s.row, runId: null } as unknown as typeof s.row);
  assert.equal(await s.getModelUsage(s.row.id), null);
  s.setDetail(s.row);
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "other/private";
  await assert.rejects(s.getModelUsage(s.row.id), /not allowed/);
});

test("failure link resolves a failed invocation only, with historical and logging-read fallback", async t => {
  const s = setup(t);
  assert.equal((await s.getModelFailure(s.row.runId, s.row.stage))?.invocationId, s.row.id);
  s.setListing([{ ...s.row, status: "succeeded" }]);
  const historical = await s.getModelFailure(s.row.runId, s.row.stage);
  assert.equal(historical?.invocationId, null);
  assert.equal(historical?.failure?.diagnostic?.kind, "incomplete-output");
  assert.equal(await s.getModelFailure(s.row.runId, "invented-stage"), null);
  s.failReads();
  const unavailable = await s.getModelFailure(s.row.runId, s.row.stage);
  assert.equal(unavailable?.logsUnavailable, true);
  assert.ok(!JSON.stringify(unavailable).includes("PRIVATE"));
});

test("pagination validates filters, preserves run/stage scope and stops on the last page", async t => {
  const s = setup(t);
  s.setListing([s.row]);
  const result = await s.listModelUsage({ repository: "example/product", runId: s.row.runId, stage: s.row.stage, status: "failed", provider: "baseten", page: "2" });
  assert.equal(result.page, 2); assert.equal(result.hasNextPage, false);
  assert.deepEqual(s.queries[0], ["https://github.com/example/product", s.row.runId, s.row.stage, { status: "failed", provider: "baseten", limit: 26, offset: 25 }]);
  for (const input of [{ page: "0" }, { page: "1.5" }, { page: "10001" }, { status: "invented" }, { provider: "invented" }]) {
    await assert.rejects(s.listModelUsage({ repository: "example/product", ...input }));
  }
  assert.equal(s.queries.length, 1);
  assert.equal((await s.listModelUsage({ repository: "example/product", status: "", provider: "", stage: "" })).page, 1);
});
