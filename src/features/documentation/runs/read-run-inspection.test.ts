import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { visualTraceFixture } from "../../../../infra/local/runner/visual-fixtures";
import { runRecordV2 } from "./run-record";
import { initialWorkflowStages } from "./run-workflow-state";

const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
test("inspection routes validate retained membership, hashes, selected/vision links and authorization; historical runs work", async t => {
  const load = createRequire(import.meta.url), id = randomUUID(), f = visualTraceFixture(1);
  for (const state of f.trace.states) {
    const s = state.snapshot;
    state.fingerprint = sha(Buffer.from(JSON.stringify({ headings: s.headings, text: s.text, regions: s.regions, controls: s.controls, overlays: s.overlays, truncated: s.truncated, pathname: s.pathname, hostContext: s.hostContext })));
  }
  const record = runRecordV2.parse({ schemaVersion: 2, input: { owner: "example", repo: "project", base: "a".repeat(40), head: "b".repeat(40), paths: [], associations: [] }, title: "Inspection", status: "finished", disposition: "interrupted", reason: "test", activeStage: null, execution: null, startedAt: null, finishedAt: new Date().toISOString(), summary: "Test", stages: initialWorkflowStages(), artifacts: [], models: [], warnings: [] });
  const checkpoint = f.trace.checkpoints[0];
  const visual = { selection: { selection: { decision: "analyze", reason: "Relevant", uncertainties: [], selected: [{ checkpointId: checkpoint.captureId, sourceRefs: ["source-1"], reason: "Relevant", question: "What is visible?" }] } }, runtime: [{ captureId: checkpoint.captureId, capturedAt: checkpoint.capturedAt, requestedPathname: "/form", finalPathname: "/form", screenshotSha256: checkpoint.screenshot!.sha256, artifactKey: checkpoint.screenshot!.artifactKey, vision: { model: "offline", elapsedMs: 0, data: { elements: [], observations: ["Visible form"], limitations: ["Viewport only"] } } }] };
  async function link(kind: "runtime-trace" | "runtime-analysis", value: unknown) {
    const bytes = Buffer.from(JSON.stringify(value)), stored = await f.storage.store(bytes);
    record.artifacts = [...record.artifacts.filter(a => a.kind !== kind), { kind, ...stored, sha256: sha(bytes) }];
  }
  await link("runtime-trace", { trace: f.trace }); await link("runtime-analysis", visual);
  let access: "allowed" | "missing" | "denied" = "allowed";
  const mocks: [string, object][] = [
    ["./run-operations.ts", { getDocumentationRun: async () => { if (access === "denied") throw Error("Repository disallowed"); return access === "missing" ? null : { id, record }; } }],
    ["../../../integrations/storage/storage.ts", { getArtifactStorage: () => f.storage }],
    ["../../../integrations/database/run-inspections.ts", { loadRunInspection: async () => null }],
  ];
  for (const [path, overrides] of mocks) {
    const resolved = load.resolve(path), original = load(resolved), cached = load.cache[resolved]!;
    cached.exports = { ...original, ...overrides }; t.after(() => { cached.exports = original; });
  }
  const readerPath = load.resolve("./read-run-inspection.ts"); delete load.cache[readerPath];
  const reader: typeof import("./read-run-inspection") = load(readerPath);
  const view = await reader.getRunInspection(id);
  assert.equal(view!.snapshot, null); assert.equal(view!.captures[0].selected, true); assert.deepEqual(view!.analysis[0].observations, ["Visible form"]);
  assert.ok(await reader.getRunInspectionScreenshot(id, checkpoint.captureId));
  assert.equal(await reader.getRunInspectionScreenshot(id, randomUUID()), null);
  assert.equal((await reader.getRunInspectionPreview(id, 1)).status, 410);
  f.bytes.set(checkpoint.screenshot!.artifactKey, Uint8Array.of(0));
  await assert.rejects(reader.getRunInspectionScreenshot(id, checkpoint.captureId), /integrity/);
  visual.selection.selection.selected[0].checkpointId = randomUUID(); await link("runtime-analysis", visual);
  await assert.rejects(reader.getRunInspection(id), /membership/);
  record.artifacts[0].sha256 = "0".repeat(64); await assert.rejects(reader.getRunInspection(id), /integrity/);
  access = "missing"; assert.equal(await reader.getRunInspection(id), null); assert.equal((await reader.getRunInspectionPreview(id, 1)).status, 404);
  access = "denied"; await assert.rejects(reader.getRunInspection(id), /disallowed/); await assert.rejects(reader.getRunInspectionScreenshot(id, checkpoint.captureId), /disallowed/);
  await assert.rejects(reader.getRunInspectionPreview(id, "../key"));
});
