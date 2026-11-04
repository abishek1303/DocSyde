import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createRequire } from "node:module";
import { join } from "node:path";
import { z } from "zod";

const load = createRequire(join(process.cwd(), "package.json"));
const path = load.resolve("./src/integrations/database/ai-model-invocations.ts");
const persistence: typeof import("@/integrations/database/ai-model-invocations") = load(path);
type Row = Parameters<typeof persistence.insertAiModelInvocation>[0];
function setup(t: TestContext, failure?: "insert" | "update", mode: "auto" | "prompt" = "prompt") {
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
  const env = { BASETEN_STRUCTURED_OUTPUT_MODE: process.env.BASETEN_STRUCTURED_OUTPUT_MODE, BASETEN_API_KEY: process.env.BASETEN_API_KEY, META_API_KEY: process.env.META_API_KEY };
  process.env.BASETEN_STRUCTURED_OUTPUT_MODE = mode;
  process.env.BASETEN_API_KEY = "PRIVATE_CREDENTIAL"; process.env.META_API_KEY = "PRIVATE_CREDENTIAL";
  t.after(() => { cachedModule.exports = original; for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const reload = ["./src/integrations/ai/invocation-log.ts", "./src/integrations/ai/generate-structured.ts", "./src/integrations/ai/generate-structured-vision.ts", "./src/integrations/ai/generate-composition.ts"];
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

test("source analysis retains bounded schema-valid debug through grounding rejection", async t => {
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
  assert.ok(s.rows.get(generated.invocationId)?.requestPayload);
  assert.ok(s.rows.get(generated.invocationId)?.responsePayload);
  assert.ok(!JSON.stringify([...s.rows.values()]).includes("PRIVATE_REASONING"));
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
  for (const row of s.rows.values()) {
    assert.equal(row.responsePayload, null);
    assert.ok(!JSON.stringify(row.diagnostic).includes("PRIVATE"));
  }
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

test("selection retains bounded instructions/input/schema and schema-valid output through acceptance", async t => {
  const s = setup(t), input = ' {"workflow":"safe","maxSelectedScreenshots":1}\n';
  const { visualSelectionOutputSchema } = await import("@/features/sources/runtime/visual-selection");
  const { invocationDebugView } = await import("@/features/documentation/runs/invocation-debug-view");
  const output = { selected: [] };
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output), reasoning_content: "UNSAFE_REASONING" } }] }));
  const generated = await s.generateStructured({ input, instructions: "Select only JSON. Bearer UNSAFE_CREDENTIAL", invocation: { ...invocation, operation: "visual-selection" }, postValidation: true, schema: visualSelectionOutputSchema(1) });
  const before = s.rows.get(generated.invocationId!)!;
  const beforeView = invocationDebugView({ ...before, failureKind: null });
  assert.equal(beforeView.input!.content, input); assert.ok(beforeView.request!.instructions.redacted);
  assert.ok(beforeView.request!.schema.content.includes('"maxItems":1'));
  assert.deepEqual(JSON.parse(beforeView.response!.output.content), output); assert.equal(before.status, "structured-success");
  await s.validateInvocation(generated.invocationId, () => {}, "correspondence-rejection", () => ({ operation: "visual-selection", payload: { decision: "skip", selected: [] } }));
  const after = s.rows.get(generated.invocationId!)!;
  assert.deepEqual(after.responsePayload, before.responsePayload); assert.equal(after.status, "succeeded");
  assert.equal(after.responseOmissionReason, null);
  assert.ok(!JSON.stringify(after).includes("UNSAFE_CREDENTIAL")); assert.ok(!JSON.stringify(after).includes("UNSAFE_REASONING"));
  const { structuredOutput, ...config } = after.inferenceConfig as Record<string, unknown>;
  assert.equal((structuredOutput as { mode: string }).mode, "prompt");
  assert.deepEqual(config, { contractVersion: "visual-selection-v3", maxOutputTokens: 3072, reasoningEffort: "low", temperature: null, topP: null });
});

test("selection schema-valid output survives each fixed correspondence rejection", async t => {
  const s = setup(t);
  const { visualSelectionOutputSchema }: typeof import("@/features/sources/runtime/visual-selection") = load("./src/features/sources/runtime/visual-selection.ts");
  const { validateVisualSelection }: typeof import("@/features/sources/runtime/select-visual-checkpoints") = load("./src/features/sources/runtime/select-visual-checkpoints.ts");
  const { summarizeRuntimeStates }: typeof import("@/features/sources/runtime/runtime-state-summary") = load("./src/features/sources/runtime/runtime-state-summary.ts");
  const { visualSourceFixture, visualTraceFixture }: typeof import("../../../infra/local/runner/visual-fixtures") = load("./infra/local/runner/visual-fixtures.ts");
  const { invocationDebugView }: typeof import("@/features/documentation/runs/invocation-debug-view") = load("./src/features/documentation/runs/invocation-debug-view.ts");
  const { randomUUID }: typeof import("node:crypto") = load("node:crypto");
  const summary = summarizeRuntimeStates(visualSourceFixture(), visualTraceFixture(2).trace, "Inspect").input;
  const item = { checkpointId: summary.candidates[0].checkpointId, sourceRefs: ["source-1"], question: "What is visible?" };
  for (const [output, limit, code, path] of [
    [{ selected: [{ ...item, checkpointId: randomUUID() }] }, 3, "unknown-checkpoint", "selected[0].checkpointId"],
    [{ selected: [item, item] }, 3, "duplicate-checkpoint", "selected[1].checkpointId"],
    [{ selected: [item, { ...item, checkpointId: summary.candidates[1].checkpointId }] }, 1, "excessive-selection-count", "selected"],
    [{ selected: [{ ...item, sourceRefs: ["source-4"] }] }, 3, "unknown-source-reference", "selected[0].sourceRefs[0]"],
    [{ selected: [{ ...item, sourceRefs: ["source-1", "source-1"] }] }, 3, "duplicate-source-reference", "selected[0].sourceRefs[1]"],
  ] as const) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] }));
    const generated = await s.generateStructured({ input: JSON.stringify(summary), instructions: "Select", invocation: { ...invocation, operation: "visual-selection" }, postValidation: true, schema: visualSelectionOutputSchema(3) });
    await assert.rejects(s.validateInvocation(generated.invocationId, () => validateVisualSelection(generated.data, summary, limit), "correspondence-rejection"));
    const row = s.rows.get(generated.invocationId!)!;
    const view = invocationDebugView({ ...row, failureKind: row.failureKind ?? null });
    assert.equal(row.status, "failed"); assert.equal(view.diagnostic?.code, code); assert.equal(view.diagnostic?.path, path);
    assert.deepEqual(JSON.parse(view.response!.output.content), output);
  }
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
    await assert.rejects(s.generateStructured({...options,instructions:'Select JSON',input:'{"workflow":"safe"}',invocation:{...invocation,operation:"visual-selection"}}));
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

test("source citation rejection preserves schema-valid output and bounded correspondence details", async t => {
  const s = setup(t);
  const { default: fixture } = await import("@/features/sources/analysis/fixtures/blocked-status.json");
  const { productChangeOutput } = await import("@/features/sources/analysis/product-change-analysis");
  const { serializeProductEvidence } = await import("@/features/sources/analysis/product-change-evidence");
  const { validateWithDiagnostics } = await import("@/features/sources/analysis/analysis-diagnostics");
  const bundle = fixture.bundle as import("@/features/sources/analysis/product-change-analysis").ProductBundle;
  const input = serializeProductEvidence(bundle);
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(fixture.output) } }] }));
  const result = await s.generateStructured({ ...options, input, schema: productChangeOutput, postValidation: true });
  const before = s.rows.get(result.invocationId!)!.responsePayload;
  await assert.rejects(s.validateInvocation(result.invocationId, () => validateWithDiagnostics(result.data, bundle, input), "grounding-rejection"), /citation-range-mismatch/);
  const row = s.rows.get(result.invocationId!)!;
  assert.equal(row.status, "failed"); assert.deepEqual(row.responsePayload, before);
  const { invocationDebugView } = await import("@/features/documentation/runs/invocation-debug-view");
  const view = invocationDebugView({ ...row, failureKind: row.failureKind ?? null });
  assert.ok(view.request); assert.ok(view.response);
  assert.equal(view.diagnostic?.code, "citation-range-mismatch");
  assert.equal(view.diagnostic?.path, "findings[2].citations[0]");
});

test("source v5 logs model references separately from canonical excerpts and retains invalid-reference diagnostics", async t => {
  const s = setup(t);
  const { default: fixture } = await import("@/features/sources/analysis/fixtures/blocked-status.json");
  const { productChangeGenerationOutput } = await import("@/features/sources/analysis/product-change-analysis");
  const { serializeProductEvidence } = await import("@/features/sources/analysis/product-change-evidence");
  const { validateWithDiagnostics } = await import("@/features/sources/analysis/analysis-diagnostics");
  const { invocationDebugView } = await import("@/features/documentation/runs/invocation-debug-view");
  const bundle = fixture.bundle as import("@/features/sources/analysis/product-change-analysis").ProductBundle;
  const input = serializeProductEvidence(bundle);
  for (const invalid of [false, true]) {
    const output = { uncertainties: fixture.output.uncertainties, findings: fixture.output.findings.map(({ reachabilityEvidenceIds: _legacyReachability, ...f }) => {
    assert.ok(Array.isArray(_legacyReachability));
    return ({ ...f, kind: "product-behavior", citations: f.citations.map(({ evidenceId, startLine, endLine }) => ({ evidenceId, startLine, endLine })) });
  }) };
    if (invalid) output.findings[2].citations[0].evidenceId = "unknown";
    t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] }));
    const generated = await s.generateStructured({ ...options, input, schema: productChangeGenerationOutput, postValidation: true });
    const validated = s.validateInvocation(generated.invocationId, () => validateWithDiagnostics(generated.data, bundle, input, true), "grounding-rejection");
    if (invalid) await assert.rejects(validated, /unknown-evidence/);
    else assert.ok((await validated).findings[2].citations[0].excerpt.endsWith(";"));
    const row = s.rows.get(generated.invocationId!)!;
    const view = invocationDebugView({ ...row, failureKind: row.failureKind ?? null });
    assert.equal(row.status, invalid ? "failed" : "succeeded");
    assert.ok(!view.response!.output.content.includes('"excerpt"'));
    assert.match(view.responseAvailability, /model-returned citation references/);
    if (invalid) assert.equal(view.diagnostic?.code, "unknown-evidence");
  }
});

test("product-impact invalid-root diagnostics survive logging without retaining output values", async t => {
  const s = setup(t);
  const payload = JSON.stringify({ value: "semantic result", impact: { token: "PRIVATE_VALUE" }, SECRET_KEY_NAME: "PRIVATE_VALUE" });
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: payload } }], usage: { prompt_tokens: 12, completion_tokens: 8 } }));
  await assert.rejects(s.generateStructured({ ...options, invocation: { ...invocation, operation: "product-impact", stage: "impact-synthesis" }, postValidation: true }), /schema-mismatch/);
  const row = [...s.rows.values()][0];
  assert.equal(row.status, "failed"); assert.equal(row.responsePayload, null);
  assert.equal(row.responseOmissionReason, "model-failure");
  const { modelDiagnosticSchema } = await import("./model-diagnostic");
  const diagnostic = modelDiagnosticSchema.parse(row.diagnostic);
  assert.equal(diagnostic.boundary?.normalization, "rejected");
  assert.equal(diagnostic.boundary?.outputBytes, Buffer.byteLength(payload));
  assert.equal(s.rows.size, 3);
  assert.ok(!JSON.stringify(row.diagnostic).includes("PRIVATE_VALUE"));
  assert.ok(!JSON.stringify(row.diagnostic).includes("SECRET_KEY_NAME"));
});

test("runtime decision v3 retains compact IR and unknown-target diagnostics without canonical echoes", async t => {
  const s = setup(t);
  const { inspectionDecisionIRSchema } = await import("@/features/sources/runtime/inspection-decision-ir");
  const { resolveRuntimeDecision } = await import("@/features/sources/runtime/decide-runtime-inspection");
  const { default: fixture } = await import("@/features/sources/impact/fixtures/blocked-impact.json");
  const { storedProductResult } = await import("@/features/sources/analysis/stored-product-result");
  const { invocationDebugView } = await import("@/features/documentation/runs/invocation-debug-view");
  const source = storedProductResult.parse(fixture.source);
  const output = { status: "inspect", reason: "Check Blocked", staticEvidence: "sufficient", targets: [{ findingRef: "finding-1", targetRef: "target-0", reason: "Check changed status" }], uncertainties: [] };
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] }));
  const result = await s.generateStructured({ ...options, invocation: { ...invocation, stage: "runtime-decision", operation: "runtime-decision" }, schema: inspectionDecisionIRSchema, postValidation: true });
  await assert.rejects(s.validateInvocation(result.invocationId, () => resolveRuntimeDecision(result.data, source, []), "correspondence-rejection"), /unsupported-route/);
  const row = s.rows.get(result.invocationId!)!; const view = invocationDebugView({ ...row, failureKind: row.failureKind ?? null });
  assert.deepEqual(JSON.parse(view.response!.output.content), output);
  assert.equal(view.diagnostic?.path, "targets[0].targetRef");
  assert.match(view.responseAvailability, /compact routing references/);
});

test("format retry has identical input/model/settings/schema and only one corrective instruction", async t => {
  const s=setup(t);
  const requests: Record<string, unknown>[]=[];
  const fetch=t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({choices:[{finish_reason:"stop",message:{content:requests.length===1?'Broken JSON':'{"value":"yes"}'}}]});
  });
  const result=await s.generateStructured(options);
  assert.equal(fetch.mock.callCount(),2);assert.equal(result.data.value,"yes");assert.equal(result.metadata?.boundary?.attempt,2);
  const first=requests[0],second=requests[1];
  assert.equal(first.model,second.model);assert.equal(first.max_tokens,second.max_tokens);
  const a=first.messages as {content:string}[],b=second.messages as {content:string}[];
  assert.deepEqual(a[1],b[1]);assert.equal(b[0].content,a[0].content+'\nReturn only one complete valid JSON object matching the requested schema. No prose or wrapper. Preserve the original evidence and exact references.');
});
for(const [content,reason,calls] of [["broken","stop",3],['{"value":3}',"stop",1],['{"value":"yes"}',"length",3]] as const) test(`bounded retry ${reason} ${content}`,async t=>{
  const s=setup(t);
  const fetch=t.mock.method(globalThis,"fetch",async()=>Response.json({choices:[{finish_reason:reason,message:{content}}]}));
  await assert.rejects(s.generateStructured(options));assert.equal(fetch.mock.callCount(),calls);
});
test("product-impact supported wrapper and metadata succeed without retry",async t=>{
  const s=setup(t);
  const fetch=t.mock.method(globalThis,"fetch",async()=>Response.json({choices:[{finish_reason:"stop",message:{content:'```json\n{"impact":{"value":"yes","metadata":{}}}\n```'}}]}));
  const result=await s.generateStructured({...options,invocation:{stage:"impact-synthesis",operation:"product-impact"}});
  assert.deepEqual(result.data,{value:"yes"});assert.equal(fetch.mock.callCount(),1);
  assert.equal(result.metadata?.boundary?.wrapper,"impact");assert.equal(result.metadata?.boundary?.ignoredCount,1);
});

test("accepted recovery metadata survives into usage UI; semantic rejection never retries",async t=>{
  const s=setup(t);
  const fetch=t.mock.method(globalThis,"fetch",async()=>Response.json({choices:[{finish_reason:"stop",message:{content:'Answer: {"value":"yes","metadata":{"token":"PRIVATE"}}'}}]}));
  const result=await s.generateStructured({...options,postValidation:true});
  const row=s.rows.get(result.invocationId!)!;
  const {invocationDebugView}=await import("@/features/documentation/runs/invocation-debug-view");
  const view=invocationDebugView({...row,failureKind:null});
  assert.match(view.boundaryMessage!,/normalized provider fields/);
  assert.match(view.boundaryMessage!,/surrounded/);
  assert.ok(!JSON.stringify(row.diagnostic).includes("PRIVATE"));
  await assert.rejects(s.validateInvocation(result.invocationId,()=>{throw Error("invented reference");},"grounding-rejection"));
  assert.equal(fetch.mock.callCount(),1);
});
test("format retry is suppressed when first attempt cannot be logged",async t=>{
  const s=setup(t,"insert");
  const fetch=t.mock.method(globalThis,"fetch",async()=>Response.json({choices:[{finish_reason:"stop",message:{content:'broken'}}]}));
  await assert.rejects(s.generateStructured(options),/invalid-json/);assert.equal(fetch.mock.callCount(),1);
});

test("prompt mode/schema metadata is safely logged while feature reference validation remains authoritative",async t=>{
 const s=setup(t,undefined,"auto");
 t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));assert.equal(body.response_format,undefined);
  assert.ok(body.messages[0].content.startsWith("Extract product meaning\nReturn only JSON matching this schema:"));
  return Response.json({choices:[{finish_reason:"stop",message:{content:'{"claimRef":"claim-9"}'}}],usage:{prompt_tokens:20,completion_tokens:6}});
 });
 const generated=await s.generateStructured({instructions:"Extract product meaning",input:"PRIVATE_SOURCE_PATCH",schema:z.object({claimRef:z.string()}).strict(),invocation,postValidation:true});
 const row=s.rows.get(generated.invocationId!)!;
 const config=row.inferenceConfig as {structuredOutput:{mode:string;schemaName:string;schemaVersion:string;schemaSha256:string}};
 assert.equal(config.structuredOutput.mode,"prompt");assert.equal(config.structuredOutput.schemaName,"source-analysis-v5");assert.equal(config.structuredOutput.schemaVersion,"source-analysis-v5");assert.match(config.structuredOutput.schemaSha256,/^[a-f0-9]{64}$/);
 assert.ok(!JSON.stringify(config).includes("PRIVATE_SOURCE_PATCH"));assert.equal(row.completionReason,"stop");assert.equal(row.inputTokens,20);
 await assert.rejects(s.validateInvocation(generated.invocationId,()=>{if(!["claim-1"].includes(generated.data.claimRef))throw new Error("Unknown claim reference");},"grounding-rejection"),/Unknown claim reference/);
 assert.equal(s.rows.get(generated.invocationId!)!.failureKind,"grounding-rejection");
});

test("safe success and truncation logs retain reasoning counts and visible sizes only", async t => {
  const s = setup(t, undefined, "auto");
  for (const [operation, effort] of Object.entries({ "source-analysis": "medium", "runtime-decision": "low", "visual-selection": "low", "documentation-planning": "low", "transformation-support": "low", "product-impact": "medium", "documentation-transformation": "medium" })) for (const finish of ["stop", "length"]) {
    const content = '{"value":"yes"}';
    t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: finish, message: { content, reasoning_content: "PRIVATE_REASONING" } }],
      usage: { prompt_tokens: 12, completion_tokens: 100, total_tokens: 112, completion_tokens_details: { reasoning_tokens: 94, secret: "PRIVATE_DETAIL" } } }));
    const result = s.generateStructured({ ...options, invocation: { operation, stage: "offline" } });
    if (finish === "stop") await result; else await assert.rejects(result, /incomplete-output/);
    const row = [...s.rows.values()].at(-1)!;
    const diagnostic = row.diagnostic as import("./model-diagnostic").ModelDiagnostic;
    assert.deepEqual(diagnostic.usage?.completion_tokens_details, { reasoning_tokens: 94 });
    assert.deepEqual(diagnostic.visibleResponse, { bytes: Buffer.byteLength(content), characters: content.length, jsonWhitespaceCharacters: 0, longestJsonWhitespaceRun: 0 });
    assert.equal(diagnostic.reasoningEffort, effort); assert.equal(diagnostic.completionReason, finish);
    assert.equal((row.inferenceConfig as { reasoningEffort: string }).reasoningEffort, effort);
    assert.ok(!JSON.stringify(row).includes("PRIVATE_REASONING"));
    assert.ok(!JSON.stringify(row).includes("PRIVATE_DETAIL"));
  }
});

test("Wonder logs native request, metrics and only grounding-approved output; rejects never persist raw output", async t => {
  const s = setup(t);
  const { generateComposition } = load("./src/integrations/ai/generate-composition.ts") as typeof import("./generate-composition");
  const output = { sections: [{ sectionRef: 0, title: "Guidance", content: [{ blockRef: 0, parts: [{ kind: "paragraph", text: "Work remains paused." }] }] }] };
  let content = JSON.stringify(output), calls = 0;
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    calls++; assert.equal(String(url), "https://api.meta.ai/v1/chat/completions");
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, "muse-wonder-1.0"); assert.equal(request.response_format.json_schema.strict, true);
    assert.equal(request.max_completion_tokens, 4096); assert.equal(request.reasoning_effort, undefined);
    return Response.json({ model: "muse-wonder-1.0", choices: [{ finish_reason: "stop", message: { content } }], usage: { prompt_tokens: 90, completion_tokens: 70, completion_tokens_details: { reasoning_tokens: 12 } } });
  });
  const options = { invocation: { ...invocation, stage: "documentation-transformation" } };
  const result = await generateComposition('{"candidate":"safe", "password":"PRIVATE_SECRET"}', options);
  assert.equal(s.rows.get(result.invocationId!)?.operation, "documentation-composition");
  assert.equal(s.rows.get(result.invocationId!)?.responsePayload, null);
  assert.equal(s.rows.get(result.invocationId!)?.status, "structured-success");
  assert.ok(!JSON.stringify(s.rows.get(result.invocationId!)?.requestPayload).includes("PRIVATE_SECRET"));
  await s.finishInvocationValidation(result.invocationId, undefined, () => ({ operation: "documentation-composition", payload: result.data }));
  const row = s.rows.get(result.invocationId!)!;
  assert.deepEqual(row.responsePayload, output); assert.equal(row.inputTokens, 90); assert.equal(row.outputTokens, 70);
  const { modelDiagnosticSchema } = load("./src/integrations/ai/model-diagnostic.ts") as typeof import("./model-diagnostic");
  const diagnostic = modelDiagnosticSchema.parse(row.diagnostic);
  assert.equal(diagnostic.usage?.completion_tokens_details?.reasoning_tokens, 12);
  assert.equal(diagnostic.visibleResponse?.characters, JSON.stringify(output).length);
  const rejected = await generateComposition('{}', options);
  await s.finishInvocationValidation(rejected.invocationId, "grounding-rejection");
  assert.equal(s.rows.get(rejected.invocationId!)?.responsePayload, null);
  content = "PRIVATE_MALFORMED";
  await assert.rejects(generateComposition('{}', options));
  assert.equal(calls, 5, "malformed JSON retries, schema/evidence failures do not"); assert.ok(!JSON.stringify([...s.rows.values()]).includes("PRIVATE_MALFORMED"));
});

test("Wonder HTTP validation diagnostics reach usage logs without rejected values or raw responses", async t => {
  const s = setup(t);
  const { generateComposition } = load("./src/integrations/ai/generate-composition.ts") as typeof import("./generate-composition");
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ error: {
    type: "invalid_request_error", code: "invalid_json_schema", param: "response_format",
    message: "oneOf not permitted in strict schema: PRIVATE_REJECTED_VALUE", rejectedValue: "PRIVATE_CREDENTIAL",
  } }, { status: 400 }));
  await assert.rejects(generateComposition("{}", { invocation: { ...invocation, stage: "documentation-transformation" } }));
  const row = [...s.rows.values()].at(-1)!;
  assert.equal(row.status, "failed"); assert.equal(row.failureKind, "invalid-request");
  const diagnostic = row.diagnostic as import("./model-diagnostic").ModelDiagnostic;
  assert.equal(diagnostic.providerError?.httpStatus, 400);
  assert.equal(diagnostic.providerError?.parameter, "response_format");
  assert.equal(diagnostic.providerError?.message, "Strict JSON schema does not support oneOf or allOf.");
  assert.equal(row.responsePayload, null); assert.equal(row.inputTokens, null); assert.equal(row.outputTokens, null);
  assert.ok(!JSON.stringify([...s.rows.values()]).includes("PRIVATE_REJECTED_VALUE"));
  assert.ok(!JSON.stringify([...s.rows.values()]).includes("PRIVATE_CREDENTIAL"));
  assert.equal(fetch.mock.callCount(), 1);
});


test("vision invariant diagnostics persist without rejected UI content or coordinate values", async t => {
  const s = setup(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({ model: "muse-spark-1.3", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
    elements: [{ description: "PRIVATE_UI_CONTENT", visibleText: "PRIVATE_UI_CONTENT", certainty: "uncertain", bounds: { xMin: 0.12345, yMin: 0.2, xMax: 0.5, yMax: 0.8 } }], observations: [], limitations: [],
  }) } }], usage: { prompt_tokens: 20, completion_tokens: 30 } }));
  await assert.rejects(s.generateStructuredVision({ png, context: "Inspect", invocation: { stage: "runtime-inspection", operation: "runtime-vision" } }), { code: "schema-mismatch" });
  const row = [...s.rows.values()].at(-1)!;
  assert.equal(row.status, "failed"); assert.equal(row.failureKind, "schema-mismatch");
  const diagnostic = row.diagnostic as import("./model-diagnostic").ModelDiagnostic;
  assert.equal(diagnostic.issues?.[0].invariant, "uncertain-element-must-have-null-bounds");
  assert.equal(diagnostic.issues?.[0].category, "cross-field");
  assert.equal(row.inputTokens, 20); assert.equal(row.outputTokens, 30);
  assert.equal(row.requestPayload, null); assert.equal(row.responsePayload, null);
  assert.ok(!JSON.stringify([...s.rows.values()]).includes("PRIVATE_UI_CONTENT"));
  assert.ok(!JSON.stringify([...s.rows.values()]).includes("0.12345"));
});

test("transformation reference diagnostics survive logging without rejected identifiers", async t => {
  const s = setup(t);
  const { transformationImpactFixture, transformationPlanFixture, transformationDecisionFixture, transformationEntryFixture } = await import("../../../infra/local/documentation/transformation-fixtures");
  const { transformationSource, authorizeTransformation } = await import("@/features/documentation/transformation/transformation-input");
  const { decisionResultSchema, transformationEnvelopeSchema } = await import("@/features/documentation/transformation/documentation-change-proposal");
  const { validateTransformationEntry } = await import("@/features/documentation/transformation/transformation-validation");
  const impact = transformationImpactFixture(), decision = transformationDecisionFixture(null, null, "add"), plan = transformationPlanFixture(impact, [decision]);
  const result = decisionResultSchema.parse({ decisionId: "decision-1", decision, generation: "pending", support: "not-required", reviewReady: false, saveCompatible: false, approval: "not-requested", materialization: "pending", issues: [], limitations: [], change: null, model: null, candidateId: null });
  const auth = authorizeTransformation(impact, plan, result, undefined, transformationSource(impact, invocation.runId, []), []);
  const entry = transformationEntryFixture(auth, []); assert.ok(entry.change.kind === "add-document");
  entry.change.sections[0].content[0].factRefs = ["PRIVATE_REJECTED_REFERENCE"];
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ entries: [entry] }) } }] }));
  const generated = await s.generateStructured({ instructions: "Transform", input: "{}", schema: transformationEnvelopeSchema, postValidation: true, invocation: { ...invocation, operation: "documentation-transformation" } });
  await assert.rejects(s.validateInvocation(generated.invocationId, () => validateTransformationEntry(generated.data.entries[0], auth), "correspondence-rejection"));
  const row = s.rows.get(generated.invocationId!)!, diagnostic = row.diagnostic as import("./invocation-debug").ValidationDiagnostic;
  assert.equal(row.failureKind, "correspondence-rejection");
  assert.equal(diagnostic.code, "unauthorized-reference");
  assert.deepEqual(diagnostic.reference, { category: "factRefs", reason: "unknown-in-guide", allowedCount: auth.facts.length, receivedCount: 1 });
  assert.equal(row.responsePayload, null);
  assert.ok(!JSON.stringify([...s.rows.values()]).includes("PRIVATE_REJECTED_REFERENCE"));
});

const proseSchema = z.object({ findings: z.array(z.object({ description: z.string().min(1).max(500), kind: z.enum(["product-behavior"]) }).strict()).max(4) }).strict();
const longProse = { findings: [{ description: "PRIVATE_OVERLONG_TEXT".repeat(30), kind: "product-behavior" }] };
const conciseProse = { findings: [{ description: "Users can search issue descriptions.", kind: "product-behavior" }] };

test("pure description overflow is logged and regenerated once with exact counts and unchanged evidence/settings", async t => {
  const s = setup(t);
  const requests: { model: string; max_tokens: number; messages: { content: string }[] }[] = [];
  const fetch = t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(requests.length === 1 ? longProse : conciseProse) } }] });
  });
  const result = await s.generateStructured({ ...options, schema: proseSchema, postValidation: true });
  assert.deepEqual(result.data, conciseProse); assert.equal(fetch.mock.callCount(), 2);
  assert.deepEqual(requests[0].messages[1], requests[1].messages[1]);
  assert.equal(requests[0].model, requests[1].model); assert.equal(requests[0].max_tokens, requests[1].max_tokens);
  assert.ok(requests[1].messages[0].content.includes('"path":"findings.0.description","maximum":500,"actual":630'));
  assert.ok(!requests[1].messages[0].content.includes("PRIVATE_OVERLONG_TEXT"));
  const rows = [...s.rows.values()]; assert.equal(rows.length, 2);
  const { modelDiagnosticSchema } = await import("./model-diagnostic");
  const first = modelDiagnosticSchema.parse(rows[0].diagnostic);
  assert.equal(first.boundary?.retryReason, "prose-length");
  assert.deepEqual(first.boundary?.proseLengthIssues, [{ path: "findings.0.description", maximum: 500, actual: 630 }]);
  assert.equal(first.issues?.[0].actual, 630); assert.equal(first.issues?.[0].maximum, 500);
  assert.equal(rows[0].responsePayload, null); assert.equal(rows[1].status, "structured-success");
  const { invocationDebugView } = await import("@/features/documentation/runs/invocation-debug-view");
  assert.match(invocationDebugView({ ...rows[1], failureKind: null }).boundaryMessage!, /prose-length retry/);
  await assert.rejects(s.validateInvocation(result.invocationId, () => { throw new Error("Unsupported claim"); }, "grounding-rejection"));
  assert.equal(fetch.mock.callCount(), 2, "Feature grounding never regenerates.");
});

test("length recovery shares the three-call cap and never retries mixed errors", async t => {
  for (const [label, content, finish, expected] of [
    ["persistent length", longProse, "stop", 3],
    ["mixed enum", { findings: [{ ...longProse.findings[0], kind: "invented" }] }, "stop", 1],
    ["truncation", longProse, "length", 3],
  ] as const) await t.test(label, async t => {
    const s = setup(t);
    const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(content) } }] }));
    await assert.rejects(s.generateStructured({ ...options, schema: proseSchema }));
    assert.equal(fetch.mock.callCount(), expected);
  });
});

for (const failure of ["insert", "update"] as const) test(`length recovery requires a retained failed attempt (${failure})`, async t => {
  const s = setup(t, failure);
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(longProse) } }] }));
  await assert.rejects(s.generateStructured({ ...options, schema: proseSchema })); assert.equal(fetch.mock.callCount(), 1);
});

test("explicit single-attempt budgets suppress length recovery", async t => {
  const s = setup(t);
  const { withInferenceBudget } = await import("./inference-budget");
  const { resolveInference, inferenceSnapshot } = await import("./operation-policy");
  const settings = resolveInference("baseten", "source-analysis");
  const expected = { "source-analysis": { provider: "baseten" as const, model: settings.model, config: inferenceSnapshot("source-analysis", settings) } };
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(longProse) } }] }));
  await withInferenceBudget(invocation.runId, expected, async () => {
    await assert.rejects(s.generateStructured({ ...options, schema: proseSchema }));
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test("inspection reason regression: 85/80 gets targeted recovery; realistic schema accepts 85 unchanged", async t => {
 const s = setup(t);
 const { inspectionDecisionIRSchema } = await import("@/features/sources/runtime/inspection-decision-ir");
 const reason = "Inspect the new workload overview and bulk triage controls using the source evidence.";
 assert.equal(reason.length, 85);
 const output = { status: "not-needed", reason, staticEvidence: "sufficient", targets: [], uncertainties: [] };
 const requests: {messages:{content:string}[]}[] = [];
 t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
  requests.push(JSON.parse(String(init?.body)));
  return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(requests.length === 1 ? output : {...output,reason:"Inspect the workload overview and bulk triage controls."})}}]});
 });
 const legacy = inspectionDecisionIRSchema.safeExtend({reason:z.string().min(1).max(80)});
 const context = {...options, schema:legacy, invocation:{...invocation,operation:"runtime-decision"}};
 const result = await s.generateStructured(context);
 assert.equal(requests.length, 2); assert.ok(result.data.reason.length <=80);
 assert.match(requests[1].messages[0].content, /"path":"reason","maximum":80,"actual":85/);
 assert.deepEqual(requests[0].messages[1],requests[1].messages[1]);
 assert.ok(inspectionDecisionIRSchema.safeParse(output).success);
});

test("minor prose whitespace overflow preserves every word and exact references without a call retry", async t => {
 const s = setup(t);
 const schema=z.object({reason:z.string().max(20),targetRef:z.string()}).strict();
 const output={reason:"   Check   workload   ",targetRef:"target-000001"};
 const fetch=t.mock.method(globalThis,"fetch",async()=>Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}]}));
 const result=await s.generateStructured({...options,schema,invocation:{...invocation,operation:"runtime-decision"}});
 assert.deepEqual(result.data,{reason:"Check workload",targetRef:output.targetRef});
 assert.equal(fetch.mock.callCount(),1);assert.equal(result.metadata?.proseNormalized,true);
});

test("formatting, prose and truncation share three attempts; ceilings grow only after length", async t => {
 const s=setup(t);const requests:{max_tokens:number;messages:{content:string}[]}[]=[];
 t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
  requests.push(JSON.parse(String(init?.body)));
  const n=requests.length;
  return Response.json({choices:[{finish_reason:n===2?"length":"stop",message:{content:n===1?"broken":JSON.stringify(n===3?conciseProse:longProse)}}]});
 });
 const result=await s.generateStructured({...options,schema:proseSchema});
 assert.deepEqual(result.data,conciseProse);assert.equal(result.metadata?.retryCount,2);
 assert.deepEqual(requests.map(r=>r.max_tokens),[8192,8192,12288]);
 assert.equal(s.rows.size,3);
 assert.match(requests[2].messages[0].content,/token ceiling/);
 const {modelDiagnosticSchema}=await import("./model-diagnostic");
 for(const row of s.rows.values()) assert.ok(modelDiagnosticSchema.safeParse(row.diagnostic).success);
});

test("repeated formatting errors exhaust at three calls with sanitized diagnostics", async t => {
 const s=setup(t);let calls=0;
 t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({choices:[{finish_reason:"stop",message:{content:"PRIVATE_BROKEN_OUTPUT"}}]});});
 await assert.rejects(s.generateStructured(options),error=>{
  assert.ok(error instanceof s.ModelError);assert.equal(error.diagnostic?.boundary?.attempt,3);
  assert.equal(error.diagnostic?.boundary?.retryReason,undefined);return true;
 });
 assert.equal(calls,3);assert.equal(s.rows.size,3);
 assert.ok(!JSON.stringify([...s.rows.values()]).includes("PRIVATE_BROKEN_OUTPUT"));
});

test("truncation remains bounded by token and call budgets; failed log prevents a length retry", async t => {
 const s=setup(t,"update");let calls=0;
 t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({choices:[{finish_reason:"length",message:{content:"PRIVATE_PARTIAL"}}]});});
 await assert.rejects(s.generateStructured(options));assert.equal(calls,1);
});

test("planning/support reasons recover, documentation content and reference overflows do not", async t => {
 for(const [operation,key] of [["documentation-planning","decisions"],["transformation-support","verdicts"]] as const) await t.test(operation,async t=>{
  const s=setup(t);let calls=0;
  const schema=z.object({[key]:z.array(z.object({reason:z.string().max(40),claimRefs:z.array(z.string())}).strict())}).strict();
  t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({[key]:[{reason:calls<3?"PRIVATE_LONG_REASON".repeat(4):"Supported by cited evidence",claimRefs:["claim-1"]}]})}}]});});
  await s.generateStructured({...options,schema,invocation:{...invocation,operation}});assert.equal(calls,3);
 });
 for(const field of ["markdown","evidenceId","pathname","excerpt","code","citation","summary"]) await t.test(field,async t=>{
  const s=setup(t);let calls=0;
  t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({[field]:"PRIVATE_PROTECTED".repeat(5)})}}]});});
  await assert.rejects(s.generateStructured({...options,schema:z.object({[field]:z.string().max(10)}).strict(),invocation:{...invocation,operation:"documentation-transformation"}}));assert.equal(calls,1);
 });
});

test("persistent truncation grows only to configured cap and a smaller run budget stops earlier",async t=>{
 for(const budgeted of [false,true]) await t.test(budgeted?"run budget":"operation cap",async t=>{
  const s=setup(t);const ceilings:number[]=[];
  t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
   ceilings.push(JSON.parse(String(init?.body)).max_tokens);
   return Response.json({choices:[{finish_reason:"length",message:{content:"PRIVATE_PARTIAL"}}]});
  });
  const run=()=>s.generateStructured(options);
  if(budgeted){
   const {withRunInferenceBudget}=await import("./inference-budget");
   await assert.rejects(withRunInferenceBudget(invocation.runId,run,{maxCalls:2}));
   assert.deepEqual(ceilings,[8192,12288]);
  }else{
   await assert.rejects(run(),error=>{assert.ok(error instanceof s.ModelError);assert.equal(error.diagnostic?.retryCount,2);return true;});
   assert.deepEqual(ceilings,[8192,12288,16384]);
  }
 });
});

test("native composition and vision recover syntax with the same three-attempt limit",async t=>{
 for(const operation of ["documentation-composition","runtime-vision"] as const) await t.test(operation,async t=>{
  const s=setup(t);let calls=0;
  t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({model:"meta-fixture",choices:[{finish_reason:"stop",message:{content:"PRIVATE_BROKEN_NATIVE"}}]});});
  const {generateComposition}:typeof import("./generate-composition")=load("./src/integrations/ai/generate-composition.ts");
  await assert.rejects(operation==="documentation-composition"?generateComposition("fixture",{invocation:{...invocation,operation}}):s.generateStructuredVision({png,context:"fixture",invocation:{...invocation,operation}}));
  assert.equal(calls,3);assert.equal(s.rows.size,3);
  for(const row of s.rows.values()) assert.ok(!JSON.stringify(row.diagnostic).includes("PRIVATE_BROKEN_NATIVE"));
 });
});

function enableDemo(t: TestContext) {
 const prior=process.env.DEMO_RELIABILITY_MODE;process.env.DEMO_RELIABILITY_MODE="true";
 t.after(()=>{if(prior===undefined)delete process.env.DEMO_RELIABILITY_MODE;else process.env.DEMO_RELIABILITY_MODE=prior;});
}

test("demo source evidence rejection remains fatal without downstream generation",async t=>{
 const s=setup(t);enableDemo(t);
 const {default:fixture}=await import("@/features/sources/analysis/fixtures/blocked-status.json");
 const {productChangeGenerationOutput}=await import("@/features/sources/analysis/product-change-analysis");
 const {serializeProductEvidence}=await import("@/features/sources/analysis/product-change-evidence");
 const {validateWithDiagnostics}=await import("@/features/sources/analysis/analysis-diagnostics");
 const output={uncertainties:fixture.output.uncertainties,findings:fixture.output.findings.map(({reachabilityEvidenceIds,...finding})=>{
  assert.ok(reachabilityEvidenceIds);return {...finding,kind:"product-behavior",citations:finding.citations.map(({evidenceId,startLine,endLine})=>({evidenceId,startLine,endLine}))};
 })};
 const invalid=structuredClone(output);invalid.findings[2].citations[0].evidenceId="PRIVATE_INVENTED_REFERENCE";
 const bundle=fixture.bundle as import("@/features/sources/analysis/product-change-analysis").ProductBundle;
 const input=serializeProductEvidence(bundle);const requests:{messages:{content:string}[];max_tokens:number}[]=[];
 t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
  requests.push(JSON.parse(String(init?.body)));
  const content=requests.length===1?invalid:requests.length===2?output:{value:"downstream"};
  return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:20,completion_tokens:10}});
 });
 const validate=(generated:import("./generate-structured").StructuredGenerationResult<typeof productChangeGenerationOutput>)=>s.validateInvocation(generated.invocationId,()=>validateWithDiagnostics(generated.data,bundle,input,true),"grounding-rejection",undefined,{deferAcceptance:true});
 await assert.rejects(s.generateStructured({...options,input,schema:productChangeGenerationOutput,postValidation:true,validate}),/unknown-evidence/);
 assert.equal(requests.length,1);
 const rows=[...s.rows.values()];assert.equal(rows[0].status,"failed");assert.equal(rows[0].failureKind,"grounding-rejection");
 assert.equal(rows[0].inputTokens,20);assert.equal(rows[0].outputTokens,10);
});

test("demo shares five attempts across format/truncation and at most two semantic corrections",async t=>{
 const s=setup(t);enableDemo(t);
 const {withValidationDiagnostic}=await import("./invocation-debug");
 const schema=z.object({reference:z.string()}).strict();let calls=0;
 t.mock.method(globalThis,"fetch",async()=>{
  calls++;return Response.json({choices:[{finish_reason:"stop",message:{content:calls<3?"broken":JSON.stringify({reference:calls<5?"PRIVATE_BAD":"source-1"})}}]});
 });
 const generated=await s.generateStructured({...options,invocation:{...invocation,operation:"documentation-planning"},schema,validate:g=>s.validateInvocation(g.invocationId,()=>{
  if(g.data.reference!=="source-1")throw withValidationDiagnostic(new Error("PRIVATE_BODY"),{validator:"source-analysis",code:"unknown-evidence",path:"findings[0].citations[0]"});
 },"grounding-rejection",undefined,{deferAcceptance:true})});
 assert.equal(calls,5);assert.equal(generated.metadata?.retryCount,4);assert.equal(generated.metadata?.semanticCorrectionCount,2);
 assert.equal(generated.metadata?.boundary?.attempt,5);
});

for(const formattingFirst of [false,true])test(`demo exhausts semantic corrections without restarting (${formattingFirst})`,async t=>{
 const s=setup(t);enableDemo(t);let calls=0;
 const {withValidationDiagnostic}=await import("./invocation-debug");
 t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({choices:[{finish_reason:"stop",message:{content:formattingFirst&&calls<5?"broken":'{"value":"bad"}'}}]});});
 await assert.rejects(s.generateStructured({...options,invocation:{...invocation,operation:"documentation-planning"},validate:g=>s.validateInvocation(g.invocationId,()=>{
  throw withValidationDiagnostic(new Error("PRIVATE_REJECTED_BODY"),{validator:"documentation-planning",code:"unknown-claim-reference",path:"decisions[0].claimRefs"});
 },"grounding-rejection",undefined,{deferAcceptance:true})}));
 assert.equal(calls,formattingFirst?5:3);
 assert.ok([...s.rows.values()].every(row=>row.status==="failed"));
 assert.ok(!JSON.stringify([...s.rows.values()].map(row=>row.diagnostic)).includes("PRIVATE_REJECTED_BODY"));
});

for(const code of ["unsupported-change-claim","unresolved-contradiction-assessment","unsupported-route","unauthorized-decision-target","missing-source-support"] as const)test(`demo does not retry ${code}`,async t=>{
 const s=setup(t);enableDemo(t);let calls=0;
 const {withValidationDiagnostic}=await import("./invocation-debug");
 t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({choices:[{finish_reason:"stop",message:{content:'{"value":"unsupported"}'}}]});});
 await assert.rejects(s.generateStructured({...options,validate:g=>s.validateInvocation(g.invocationId,()=>{
  throw withValidationDiagnostic(new Error("Semantic rejection"),{validator:"product-impact",code});
 },"grounding-rejection",undefined,{deferAcceptance:true})}));assert.equal(calls,1);
});

test("demo truncation escalates known models to conservative caps across five logged calls",async t=>{
 const s=setup(t);enableDemo(t);const ceilings:number[]=[];
 t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{ceilings.push(JSON.parse(String(init?.body)).max_tokens);return Response.json({choices:[{finish_reason:"length",message:{content:"PRIVATE_PARTIAL"}}]});});
 await assert.rejects(s.generateStructured(options));
 assert.deepEqual(ceilings,[16384,24576,32768,32768,32768]);assert.equal(s.rows.size,5);
});

test("demo missing supported coverage regenerates a ledger and revalidates it",async t=>{
 const s=setup(t);enableDemo(t);let calls=0;
 const {coverageFailure}=await import("@/features/sources/impact/source-coverage");
 const schema=z.object({covered:z.boolean()}).strict();
 t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({covered:calls>1})}}]});});
 const generated=await s.generateStructured({...options,schema,invocation:{...invocation,operation:"product-impact"},validate:g=>s.validateInvocation(g.invocationId,()=>{if(!g.data.covered)coverageFailure("missing-or-duplicate-finding");},"grounding-rejection",undefined,{deferAcceptance:true})});
 assert.equal(calls,2);assert.equal(generated.metadata?.semanticCorrection?.category,"supported-coverage");
 assert.equal(generated.metadata?.semanticCorrection?.code,"missing-or-duplicate-finding");
});

test("demo failed semantic logging and cancellation prevent correction calls",async t=>{
 for(const failure of ["update","cancel"] as const)await t.test(failure,async t=>{
  const s=setup(t,failure==="update"?"update":undefined);enableDemo(t);let calls=0;const controller=new AbortController();
  const {withValidationDiagnostic}=await import("./invocation-debug");
  t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({choices:[{finish_reason:"stop",message:{content:'{"value":"bad"}'}}]});});
  await assert.rejects(s.generateStructured({...options,signal:controller.signal,validate:g=>s.validateInvocation(g.invocationId,()=>{
   if(failure==="cancel")controller.abort();
   throw withValidationDiagnostic(new Error("Invalid ref"),{validator:"source-analysis",code:"unknown-evidence"});
  },"grounding-rejection",undefined,{deferAcceptance:true})}));assert.equal(calls,1);
 });
});

test("demo inspection stage corrects a finding ID then resolves the original route and citations",async t=>{
 const s=setup(t);enableDemo(t);
 const path=load.resolve("./src/features/sources/runtime/decide-runtime-inspection.ts"), prior=load.cache[path];delete load.cache[path];
 t.after(()=>{if(prior)load.cache[path]=prior;else delete load.cache[path];});
 const {decideRuntimeInspection}:typeof import("@/features/sources/runtime/decide-runtime-inspection")=load(path);
 const {default:fixture}=await import("@/features/sources/impact/fixtures/blocked-impact.json");
 const {storedProductResult}=await import("@/features/sources/analysis/stored-product-result");
 const source=storedProductResult.parse(fixture.source);assert.ok(source.analysis);source.analysis.findings=source.analysis.findings.slice(0,1);
 let calls=0;const inputs:string[]=[];
 t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
  calls++;const request=JSON.parse(String(init?.body));inputs.push(request.messages[1].content);
  return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({status:"inspect",reason:"Inspect status controls",staticEvidence:"sufficient",targets:[{findingRef:calls===1?"finding-4":"finding-1",targetRef:"target-0",reason:"Observe Blocked status"}],uncertainties:[]})}}]});
 });
 const result=await decideRuntimeInspection(source,{invocation:{...invocation,operation:"runtime-decision"},operatorCapabilities:{workflow:{id:"issues",version:"1",sha256:"a".repeat(64)},capabilities:[{id:"issues",pathname:"/",description:"Inspect issue status"}]}});
 assert.equal(calls,2);assert.equal(inputs[0],inputs[1]);assert.equal(result.decision.targets[0].pathname,"/");
 assert.deepEqual(result.decision.targets[0].citations,source.analysis.findings[0].citations);
 assert.deepEqual([...s.rows.values()].map(row=>row.status),["failed","succeeded"]);
});

test("demo impact stage repairs missing supported coverage and retains canonical provenance",async t=>{
 const s=setup(t);enableDemo(t);
 const path=load.resolve("./src/features/sources/impact/synthesize-product-impact.ts"),prior=load.cache[path];delete load.cache[path];
 t.after(()=>{if(prior)load.cache[path]=prior;else delete load.cache[path];});
 const {synthesizeProductImpact}:typeof import("@/features/sources/impact/synthesize-product-impact")=load(path);
 const {default:fixture}=await import("@/features/sources/impact/fixtures/blocked-impact.json");
 const {storedProductResult}=await import("@/features/sources/analysis/stored-product-result");
 const {validateProductImpact}=await import("@/features/sources/impact/validate-product-impact");
 const source=storedProductResult.parse(fixture.source);assert.ok(source.analysis);source.analysis.findings=source.analysis.findings.slice(0,1);
 let calls=0;
 t.mock.method(globalThis,"fetch",async()=>{
  calls++;return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({assessment:"product-change",summary:"Issues can start in Blocked status",claims:[{description:source.analysis!.findings[0].description,kind:"behavior-change",confidence:"high",confidenceReason:"Cited source",beforeRef:null,afterRef:null,references:["source-1"],uncertainties:[]}],contradictions:[],uncertainties:[],...(calls>1?{sourceCoverage:[{findingId:"source-1",status:"incorporated"}]}:{})})}}]});
 });
 const result=await synthesizeProductImpact({source},{invocation});
 assert.equal(calls,2);assert.equal(result.impact.provenance.source.head,source.bundle.head);
 assert.deepEqual(result.impact.provenance.sourceReferences[0].finding.citations,source.analysis.findings[0].citations);
 assert.equal(validateProductImpact(result.impact).claims.length,1);
 assert.deepEqual([...s.rows.values()].map(row=>row.status),["failed","succeeded"]);
});

test("demo native composition truncation stops at its model allowance",async t=>{
 const s=setup(t);enableDemo(t);const ceilings:number[]=[];
 const {generateComposition}:typeof import("./generate-composition")=load("./src/integrations/ai/generate-composition.ts");
 t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{ceilings.push(JSON.parse(String(init?.body)).max_completion_tokens);return Response.json({model:"muse-wonder-1.0",choices:[{finish_reason:"length",message:{content:"PRIVATE_PARTIAL"}}]});});
 await assert.rejects(generateComposition("fixture",{invocation:{...invocation,operation:"documentation-composition"}}));
 assert.deepEqual(ceilings,[8192,12288,16384,16384,16384]);assert.equal(s.rows.size,5);
});

test("demo semantic corrections cannot escape frozen single-attempt verification",async t=>{
 const s=setup(t);enableDemo(t);let calls=0;
 const {withInferenceBudget}=await import("./inference-budget");
 const {resolveInference,inferenceSnapshot}=await import("./operation-policy");
 const {withValidationDiagnostic}=await import("./invocation-debug");
 const settings=resolveInference("baseten","source-analysis");
 t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json({choices:[{finish_reason:"stop",message:{content:'{"value":"bad"}'}}]});});
 await withInferenceBudget(invocation.runId,{"source-analysis":{provider:"baseten",model:settings.model,config:inferenceSnapshot("source-analysis",settings)}},async()=>{
  await assert.rejects(s.generateStructured({...options,validate:g=>s.validateInvocation(g.invocationId,()=>{throw withValidationDiagnostic(new Error("Invalid reference"),{validator:"source-analysis",code:"unknown-evidence"});},"grounding-rejection",undefined,{deferAcceptance:true})}));
 });assert.equal(calls,1);
});
