import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { visualTraceFixture } from "../../../infra/local/runner/visual-fixtures";
import type { WorkflowRuntime } from "./capture-workflow";

const load = createRequire(join(process.cwd(), "package.json"));
const runtimePath = load.resolve("./src/runner/runtime/runtime.ts"), browserPath = load.resolve("./src/integrations/browser/capture-trace.ts"), helperPath = load.resolve("./src/runner/runtime/capture-workflow.ts");
const runtime: typeof import("./runtime") = load(runtimePath);
const browser: typeof import("@/integrations/browser/capture-trace") = load(browserPath);

function setup(t: TestContext, fail?: "capture" | "cleanup" | "both") {
  const f = visualTraceFixture(1), order: string[] = [];
  const stop = t.mock.fn(async () => { order.push("stop"); if (fail === "cleanup" || fail === "both") throw new Error("cleanup"); });
  const session = { description: { runtimeId: "runtime", mode: "attached" as const, baseUrl: "http://localhost:4317", startedAt: new Date().toISOString() }, stop };
  const start = t.mock.fn(async () => { order.push("start"); return session; });
  const capture = t.mock.fn(async (...args: Parameters<typeof browser.captureRuntimeTrace>) => {
    assert.equal(args[0].baseUrl, session.description.baseUrl); assert.strictEqual(args[1], f.storage);
    order.push("capture"); if (fail === "capture" || fail === "both") throw new Error("capture"); return f.trace;
  });
  const rm = load.cache[runtimePath]!, bm = load.cache[browserPath]!, originalRuntime = rm.exports, originalBrowser = bm.exports, originalHelper = load.cache[helperPath];
  rm.exports = { ...runtime, launchRuntime: start, attachRuntime: start }; bm.exports = { ...browser, captureRuntimeTrace: capture }; delete load.cache[helperPath];
  t.after(() => { rm.exports = originalRuntime; bm.exports = originalBrowser; if (originalHelper) load.cache[helperPath] = originalHelper; else delete load.cache[helperPath]; });
  const helper: typeof import("./capture-workflow") = load(helperPath);
  return { ...f, helper, start, stop, capture, order };
}
for (const mode of ["attach", "launch"] as const) test(`${mode} owns one complete workflow lifecycle and stops once`, async t => {
  const f = setup(t);
  const runtime: WorkflowRuntime = mode === "attach" ? { mode, options: { baseUrl: "http://localhost:4317" } }
    : { mode, options: { baseUrl: "http://localhost:4317", cwd: ".", command: "node", args: [] } };
  const result = await f.helper.captureWorkflowWithRuntime({ runtime, workflow: { steps: [{ type: "checkpoint" }] } }, f.storage);
  assert.strictEqual(result.trace, f.trace); assert.deepEqual(f.order, ["start", "capture", "stop"]);
  assert.equal(f.start.mock.callCount(), 1); assert.equal(f.stop.mock.callCount(), 1);
});

test("capture/cleanup failures propagate and combined failure preserves both errors", async t => {
  for (const fail of ["capture", "cleanup", "both"] as const) await t.test(fail, async t => {
    const f = setup(t, fail);
    await assert.rejects(f.helper.captureWorkflowWithRuntime({ runtime: { mode: "attach", options: { baseUrl: "http://localhost:4317" } }, workflow: {} }, f.storage), fail === "both" ? AggregateError : Error);
    assert.equal(f.stop.mock.callCount(), 1);
  });
});

test("pre-cancellation avoids runtime launch", async t => {
  const f = setup(t), controller = new AbortController(); controller.abort();
  await assert.rejects(f.helper.captureWorkflowWithRuntime({ runtime: { mode: "attach", options: { baseUrl: "http://localhost:4317" } }, workflow: {} }, f.storage, controller.signal));
  assert.equal(f.start.mock.callCount(), 0);
});

for (const fail of ["capture", "cleanup", "both"] as const) test(`observer errors preserve ${fail} errors and cleanup`, async t => {
  const f = setup(t, fail), observer = { event() { throw Error("observation"); }, preview() { throw Error("preview"); } };
  let caught: unknown;
  try { await f.helper.captureWorkflowWithRuntime({ runtime: { mode: "attach", options: { baseUrl: "http://localhost:4317" } }, workflow: {} }, f.storage, undefined, undefined, observer); } catch (error) { caught = error; }
  assert.ok(caught instanceof Error);
  assert.equal(caught.message, fail === "both" ? "Workflow and runtime cleanup failed." : fail);
  if (caught instanceof AggregateError) assert.deepEqual(caught.errors.map(error => error.message), ["capture", "cleanup"]);
  assert.deepEqual(f.order, ["start", "capture", "stop"]);
});
