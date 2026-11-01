import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createRequire } from "node:module";
import { join } from "node:path";
import { z } from "zod";

const load = createRequire(join(process.cwd(), "package.json"));
const path = load.resolve("./src/integrations/database/ai-model-invocations.ts");
const persistence: typeof import("@/integrations/database/ai-model-invocations") = load(path);
type Row = Parameters<typeof persistence.insertAiModelInvocation>[0];
function setup(t: TestContext, failure?: "insert" | "update") {
  const cachedModule = load.cache[path]!;
  const original = cachedModule.exports;
  const rows = new Map<string, Row>();
  const warnings: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });
  cachedModule.exports = { ...persistence,
    async insertAiModelInvocation(row: Row) { if (failure === "insert") throw new Error("PRIVATE_DATABASE_BODY"); rows.set(row.id, { ...row }); },
    async updateAiModelInvocation(id: string, values: Partial<Row>, validationOnly: boolean, operation?: string) {
      if (failure === "update") throw new Error("PRIVATE_DATABASE_BODY");
      const row = rows.get(id);
      if (row && (!operation || operation === row.operation) && (!validationOnly || row.status === "structured-success")) rows.set(id, { ...row, ...values });
    },
  };
  const env = { BASETEN_API_KEY: process.env.BASETEN_API_KEY, META_API_KEY: process.env.META_API_KEY };
  process.env.BASETEN_API_KEY = "PRIVATE_CREDENTIAL"; process.env.META_API_KEY = "PRIVATE_CREDENTIAL";
  t.after(() => { cachedModule.exports = original; for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const reload = ["./src/integrations/ai/invocation-log.ts", "./src/integrations/ai/generate-structured.ts", "./src/integrations/ai/generate-structured-vision.ts"];
  for (const name of reload) {
    const resolved = load.resolve(name), previous = load.cache[resolved];
    delete load.cache[resolved];
    t.after(() => { if (previous) load.cache[resolved] = previous; else delete load.cache[resolved]; });
  }
  const text: typeof import("./generate-structured") = load("./src/integrations/ai/generate-structured.ts");
  const vision: typeof import("./generate-structured-vision") = load("./src/integrations/ai/generate-structured-vision.ts");
  const lifecycle: typeof import("./invocation-log") = load("./src/integrations/ai/invocation-log.ts");
  return { rows, warnings, ...text, ...vision, ...lifecycle };
}
const invocation = { runId: "851b8554-a0e8-4a8a-b09d-a1ee7434f437", stage: "source-analysis", operation: "source-analysis" };
const options = { input: "PRIVATE_SOURCE_PATCH", instructions: "PRIVATE_INSTRUCTIONS", schema: z.object({ value: z.string() }).strict(), invocation };
const png = new Uint8Array([137,80,78,71,13,10,26,10,1]);

test("text invocation metadata, explicit correlation and local validation do not retain payloads", async t => {
  const s = setup(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"value":"PRIVATE_OUTPUT"}', reasoning_content: "PRIVATE_REASONING" } }], usage: { prompt_tokens: 12, completion_tokens: 8 } }));
  const generated = await s.generateStructured({ ...options, postValidation: true });
  assert.ok(generated.invocationId);
  const row = s.rows.get(generated.invocationId)!;
  assert.equal(row.status, "structured-success"); assert.equal(row.runId, invocation.runId);
  assert.equal(row.stage, invocation.stage); assert.equal(row.operation, invocation.operation);
  assert.equal(row.provider, "baseten"); assert.equal(row.inputTokens, 12); assert.equal(row.outputTokens, 8);
  assert.equal(row.completionReason, "stop"); assert.equal(typeof row.elapsedMs, "number");
  const rejection = new Error("PRIVATE_REJECTED_CONTENT");
  await assert.rejects(s.validateInvocation(generated.invocationId, () => { throw rejection; }, "grounding-rejection"), error => error === rejection);
  assert.equal(s.rows.get(generated.invocationId)?.failureKind, "grounding-rejection");
  assert.equal(s.rows.get(generated.invocationId)?.completionReason, "stop");
  assert.ok(!JSON.stringify([...s.rows.values()]).includes("PRIVATE"));
});

test("safe failure classification and usage survive incomplete, malformed, schema-invalid and refused output", async t => {
  const s = setup(t);
  for (const [content, reason, refusal, failure] of [["PRIVATE_MALFORMED", "stop", null, "invalid-json"], ['{"value":42}', "stop", null, "schema-mismatch"], ["PRIVATE_PARTIAL", "length", null, "incomplete-output"], [null, "stop", "PRIVATE_REFUSAL", "refused"]]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: reason, message: { content, refusal } }], usage: { completion_tokens: 8192 } }));
    await assert.rejects(s.generateStructured(options));
    const row = [...s.rows.values()].at(-1)!;
    assert.equal(row.status, "failed"); assert.equal(row.failureKind, failure);
    assert.equal(row.completionReason, reason); assert.equal(row.outputTokens, 8192);
  }
  t.mock.method(globalThis, "fetch", async () => new Response("PRIVATE_PROVIDER_BODY", { status: 401 }));
  await assert.rejects(s.generateStructured(options));
  assert.equal([...s.rows.values()].at(-1)?.failureKind, "unauthorized");
  assert.ok(!JSON.stringify([...s.rows.values()]).includes("PRIVATE"));
});

test("vision records equivalent optional metadata without retaining bytes, output or reasoning", async t => {
  const s = setup(t);
  for (const usage of [undefined, { prompt_tokens: 20, completion_tokens: 10 }, { prompt_tokens: "bad" }]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ model: "returned-vision", choices: [{ finish_reason: "stop", message: { content: '{"elements":[],"observations":["PRIVATE_VISIBLE_TEXT"],"limitations":[]}', reasoning_content: "PRIVATE_REASONING" } }], usage }));
    await s.generateStructuredVision({ png, context: "PRIVATE_CONTEXT", invocation: { stage: "runtime-inspection", operation: "runtime-vision" } });
    const row = [...s.rows.values()].at(-1)!;
    assert.equal(row.runId, null); assert.equal(row.provider, "meta"); assert.equal(row.model, "returned-vision");
    assert.equal(row.status, "succeeded"); assert.equal(row.completionReason, "stop");
    assert.deepEqual(row.responsePayload, { elements: [], observationCount: 1, limitationCount: 0 });
    assert.equal(row.inputTokens, usage && typeof usage.prompt_tokens === "number" ? 20 : null);
  }
  t.mock.method(globalThis, "fetch", async () => Response.json({ model: "returned-vision", choices: [{ finish_reason: "length", message: { content: "PRIVATE_PARTIAL" } }], usage: { completion_tokens: 4096 } }));
  await assert.rejects(s.generateStructuredVision({ png, context: "Inspect" }));
  assert.equal([...s.rows.values()].at(-1)?.outputTokens, 4096);
  assert.equal([...s.rows.values()].at(-1)?.failureKind, "incomplete-output");
  assert.ok(!JSON.stringify([...s.rows.values()]).includes("PRIVATE"));
});

for (const failure of ["insert", "update"] as const) test(`${failure} failures never overwrite model results or errors, and warnings are safe`, async t => {
  const s = setup(t, failure);
  let calls = 0;
  const original = { model: "fixture", value: "PRIVATE_RESULT" };
  const result = await s.logStructuredInvocation({ provider: "baseten" }, async () => { calls++; return original; });
  assert.equal(calls, 1); assert.equal(result.value, original.value);
  const error = new Error("PRIVATE_ORIGINAL_FAILURE");
  await assert.rejects(s.logStructuredInvocation({ provider: "meta" }, async () => { throw error; }), thrown => thrown === error);
  await s.finishInvocationValidation(result.invocationId, "correspondence-rejection");
  const validationError = new Error("PRIVATE_VALIDATION_FAILURE");
  await assert.rejects(s.validateInvocation(result.invocationId, () => { throw validationError; }, "grounding-rejection"), thrown => thrown === validationError);
  assert.ok(s.warnings.length); assert.ok(!JSON.stringify(s.warnings).includes("PRIVATE"));
});

test("concurrent calls retain distinct explicit contexts and successful validation completes locally", async t => {
  const s = setup(t);
  const results = await Promise.all(["source-analysis", "documentation-planning"].map(operation => s.logStructuredInvocation({ provider: "baseten", postValidation: true, invocation: { ...invocation, operation } }, async () => ({ model: operation }))));
  assert.notEqual(results[0].invocationId, results[1].invocationId);
  for (const result of results) {
    await s.validateInvocation(result.invocationId, () => true, "correspondence-rejection");
    const row = s.rows.get(result.invocationId!)!;
    assert.equal(row.operation, result.model); assert.equal(row.status, "succeeded");
    assert.equal(row.inputTokens, null); assert.equal(row.outputTokens, null);
  }
});

test("approved selection retains exact input but response waits for correspondence acceptance", async t => {
  const s = setup(t), input = ' {"workflow":"safe","maxSelectedScreenshots":1}\n';
  const context = { ...invocation, operation: "visual-selection" };
  t.mock.method(globalThis,"fetch",async()=>Response.json({choices:[{finish_reason:"stop",message:{content:'{"decision":"skip","selected":[],"reason":"PRIVATE_PROSE"}'}}]}));
  const generated = await s.generateStructured({ input, instructions:"PRIVATE_STATIC_INSTRUCTIONS", invocation:context, postValidation:true,
    schema:z.object({decision:z.literal("skip"),selected:z.array(z.never()),reason:z.string()}) });
  const before=s.rows.get(generated.invocationId!)!;
  assert.deepEqual(before.requestPayload,{input}); assert.equal(before.responsePayload,null);
  assert.equal(before.responseOmissionReason,"pending-validation");
  await s.validateInvocation(generated.invocationId,()=>{},"correspondence-rejection",()=>({operation:"visual-selection",payload:{decision:"skip",selected:[]}}));
  const after=s.rows.get(generated.invocationId!)!;
  assert.deepEqual(after.responsePayload,{decision:"skip",selected:[]}); assert.equal(after.responseOmissionReason,null);
  assert.equal(after.status,"succeeded"); assert.ok(!JSON.stringify(after).includes("PRIVATE"));
  assert.deepEqual(after.inferenceConfig,{contractVersion:"visual-selection-v2",maxOutputTokens:2048,reasoningEffort:null,temperature:null,topP:null});
});

test("post-validation rejection and interrupted validation never persist accepted response content", async t => {
  const s=setup(t);
  const generated=await s.logStructuredInvocation({provider:"baseten",postValidation:true,invocation:{...invocation,operation:"transformation-support"}},async()=>({model:"fixture"}));
  assert.equal(s.rows.get(generated.invocationId!)?.responsePayload,null);
  let projected=false;
  const error=new Error("PRIVATE_REJECTED_OUTPUT");
  await assert.rejects(s.validateInvocation(generated.invocationId,()=>{throw error;},"correspondence-rejection",()=>{projected=true;return {operation:"transformation-support",payload:{verdicts:[]}};}),e=>e===error);
  assert.equal(projected,false); assert.equal(s.rows.get(generated.invocationId!)?.responseOmissionReason,"pending-validation");
});

test("approved operation omits failed outputs, including malformed, incomplete and refused results", async t => {
  const s=setup(t);
  for(const [content,reason,refusal] of [["PRIVATE_MALFORMED","stop",null],["PRIVATE_PARTIAL","length",null],[null,"stop","PRIVATE_REFUSAL"],['{"value":5}',"stop",null]]) {
    t.mock.method(globalThis,"fetch",async()=>Response.json({choices:[{finish_reason:reason,message:{content,refusal}}]}));
    await assert.rejects(s.generateStructured({...options,input:'{"workflow":"safe"}',invocation:{...invocation,operation:"visual-selection"}}));
    const row=[...s.rows.values()].at(-1)!; assert.equal(row.responsePayload,null); assert.equal(row.responseOmissionReason,"model-failure");
  }
  assert.ok(!JSON.stringify([...s.rows.values()]).includes("PRIVATE"));
});

test("oversized request and projection failure do not change successful model results or completion metadata",async t=>{
  const s=setup(t);
  const result=await s.logStructuredInvocation({provider:"baseten",input:"x".repeat(128*1024),invocation:{...invocation,operation:"visual-selection"},acceptedResponse:()=>{throw new Error("PRIVATE_PROJECTION_FAILURE");}},async()=>({model:"fixture",value:42}));
  assert.equal(result.value,42);
  const row=s.rows.get(result.invocationId!)!;
  assert.equal(row.requestPayload,null);assert.equal(row.requestOmissionReason,"oversized");
  assert.equal(row.status,"succeeded");assert.equal(row.responseOmissionReason,"logging-data-invalid");
});

test("runtime-decision regression retains schema-valid output and exact correspondence diagnostic after rejection", async t => {
  const s = setup(t);
  const { inspectionDecisionSchema } = await import("@/features/sources/runtime/inspection-decision");
  const { validateRuntimeDecision } = await import("@/features/sources/runtime/decide-runtime-inspection");
  const { invocationDebugView } = await import("@/features/documentation/runs/invocation-debug-view");
  const output = { status: "inspect", reason: "Inspect the changed UI", staticEvidence: "sufficient", targets: [{ pathname: "/unsupported", description: "UI", visibleEvidence: ["label"], citations: [{ evidenceId: "e1", startLine: 1, endLine: 1, excerpt: "label" }] }], uncertainties: [] };
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output), reasoning_content: "UNSAFE_REASONING" } }], usage: { prompt_tokens: 12, completion_tokens: 8 }, unsafe: "UNSAFE_PROVIDER_METADATA" }));
  const result = await s.generateStructured({ instructions: "Decide", input: '{"evidence":"label","api_key":"UNSAFE_SECRET"}', schema: inspectionDecisionSchema,
    invocation: { ...invocation, stage: "runtime-decision", operation: "runtime-decision" }, postValidation: true });
  const bundle = { repository: "fixture", base: "a".repeat(40), head: "b".repeat(40), inventory: [], limited: false, notice: "", evidence: [{ id: "e1", path: "ui.tsx", side: "head" as const, commitId: "b".repeat(40), text: "label", status: "available", changed: true }] };
  await assert.rejects(s.validateInvocation(result.invocationId, () => validateRuntimeDecision(result.data, bundle, []), "correspondence-rejection"), /unsupported-route/);
  const row = s.rows.get(result.invocationId!)!;
  const view = invocationDebugView({ ...row, failureKind: row.failureKind ?? null });
  assert.equal(row.status, "failed"); assert.equal(row.completionReason, "stop");
  assert.equal(view.diagnostic?.code, "unsupported-route"); assert.equal(view.diagnostic?.path, "targets[0].pathname");
  assert.equal(view.diagnostic?.expectedSha256?.length, 64);
  assert.deepEqual(JSON.parse(view.response!.output.content), output);
  assert.ok(view.request); assert.ok(!JSON.stringify(row).includes("UNSAFE"));
});

test("allowlisted malformed and schema-invalid output is never retained", async t => {
  const s = setup(t);
  for (const content of ["UNSAFE_MALFORMED", '{"value":23,"unsafe":"UNSAFE_OUTPUT"}']) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content } }] }));
    await assert.rejects(s.generateStructured({ ...options, invocation: { ...invocation, operation: "runtime-decision" } }));
    const row = [...s.rows.values()].at(-1)!;
    assert.equal(row.responsePayload, null); assert.equal(row.responseOmissionReason, "model-failure");
    assert.ok(!JSON.stringify(row).includes("UNSAFE"));
  }
});
