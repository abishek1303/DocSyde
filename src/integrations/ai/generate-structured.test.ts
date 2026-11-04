import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { generateStructured, ModelError } from "@/integrations/ai/generate-structured";
const options = { instructions: "Extract", input: "value", schema: z.object({ value: z.string() }).strict() };
for (const [content, reason, code] of [[ '{"value":"yes"}', "stop", null ], ["oops", "stop", "invalid-json"], ['{"value":3}', "stop", "schema-mismatch"], ['{"value":"yes"}', "length", "incomplete-output"]] as const) {
  test(`model response ${code ?? "success"}`, async (t) => {
    const previous = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "test";
    t.after(() => { if (previous === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = previous; });
    t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
      assert.equal(JSON.parse(String(init.body)).response_format, undefined);
      return Response.json({ choices: [{ finish_reason: reason, message: { content, reasoning_content: "ignored" } }] });
    });
    if (code) await assert.rejects(generateStructured(options), new RegExp(code));
    else assert.deepEqual((await generateStructured(options)).data, { value: "yes" });
  });
}
for (const status of [401, 402, 404, 429, 500]) {
  test(`sanitized model HTTP ${status}`, async (t) => {
    const previous = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "never-expose";
    t.after(() => { if (previous === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = previous; });
    t.mock.method(globalThis, "fetch", async () => Response.json({ secret: "never-expose" }, { status, headers: { "retry-after": "12" } }));
    await assert.rejects(generateStructured(options), (error: unknown) => {
      assert.ok(error instanceof Error); assert.ok(!error.message.includes("never-expose")); return true;
    });
  });
}
test("missing credentials and unsupported schemas fail before network access", async (t) => {
  const previous = process.env.BASETEN_API_KEY; delete process.env.BASETEN_API_KEY;
  t.after(() => { if (previous !== undefined) process.env.BASETEN_API_KEY = previous; });
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("No network expected"); });
  await assert.rejects(generateStructured(options), /missing-credentials/);
  await assert.rejects(generateStructured({ ...options, schema: z.date() }), /unsupported-schema/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("failed validation keeps bounded diagnostics and usage without output values or unknown keys", async t => {
  const previous = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "test";
  t.after(() => { if (previous === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = previous; });
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ value: 123, "private-key-name": "private-value" }) } }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } }));
  await assert.rejects(generateStructured({ ...options, schema: z.object({ value: z.string() }).strict() }), (error: unknown) => {
    assert.ok(error instanceof ModelError);
    assert.equal(error.diagnostic?.kind, "schema-mismatch");
    assert.equal(error.diagnostic?.completionReason, "stop");
    assert.equal(error.diagnostic?.usage?.total_tokens, 20);
    assert.ok(error.diagnostic?.issues?.some(issue => issue.path === "value"));
    assert.ok(!JSON.stringify(error.diagnostic).includes("private"));
    return true;
  });
});

test("provider usage extensions do not invalidate an otherwise valid inference response", async t => {
  const previous = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "test";
  t.after(() => { if (previous === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = previous; });
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"value":"yes"}' } }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20, completion_tokens_details: { reasoning_tokens: 4 } } }));
  assert.deepEqual((await generateStructured(options)).data, { value: "yes" });
});

test("unavailable or malformed optional usage never rejects valid generated content", async t => {
  const previous = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "test";
  t.after(() => { if (previous === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = previous; });
  for (const usage of [null, { total_tokens: "unavailable" }]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"value":"yes"}' } }], usage }));
    assert.deepEqual((await generateStructured(options)).data, {value:"yes"});
  }
});

test("opt-in product-impact key diagnostics remain bounded; malformed JSON and other operations disclose no keys", async t => {
  const priorMode=process.env.BASETEN_STRUCTURED_OUTPUT_MODE; process.env.BASETEN_STRUCTURED_OUTPUT_MODE="prompt";
  t.after(()=>{if(priorMode===undefined)delete process.env.BASETEN_STRUCTURED_OUTPUT_MODE;else process.env.BASETEN_STRUCTURED_OUTPUT_MODE=priorMode;});
  const { parseStructuredOutput } = await import("./structured-output");
  const input = JSON.stringify({ value: "yes", ...Object.fromEntries(["impact", "analysis", "source", "runtime", "title", "metadata", "provenance", "result", "repository", "SECRET_KEY_NAME"].map(key => [key, "PRIVATE_VALUE"])) });
  assert.throws(() => parseStructuredOutput(input, options.schema, true), error => {
    assert.ok(error instanceof ModelError);
    assert.equal(error.diagnostic?.issues?.[0].unexpectedKeys?.length, 8);
    assert.equal(error.diagnostic?.issues?.[0].extraKeyCount, 10);
    assert.equal(error.diagnostic?.issues?.[0].withheldKeyCount, 2);
    assert.ok(Buffer.byteLength(JSON.stringify(error.diagnostic)) < 4096); return true;
  });
  assert.throws(() => parseStructuredOutput(input, options.schema), error => {
    assert.ok(error instanceof ModelError); assert.equal(error.diagnostic?.schemaFailure, undefined);
    assert.equal(error.diagnostic?.issues?.[0].unexpectedKeys, undefined); return true;
  });
  assert.throws(() => parseStructuredOutput("PRIVATE_MALFORMED", options.schema, true), error => {
    assert.ok(error instanceof ModelError); assert.equal(error.diagnostic, undefined); return true;
  });
  const previous = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "fixture";
  t.after(() => { if(previous === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = previous; });
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: input } }] }));
  await assert.rejects(generateStructured({ ...options, invocation: { stage: "impact-synthesis", operation: "product-impact" } }), error => {
    assert.ok(error instanceof ModelError); assert.equal(error.diagnostic?.boundary?.normalization, "rejected");
    assert.equal(error.diagnostic?.boundary?.attempt, 1); return true;
  });
});

test("repository understanding uses shared extraction and narrow structural normalization", async t => {
 const priorMode = process.env.BASETEN_STRUCTURED_OUTPUT_MODE; process.env.BASETEN_STRUCTURED_OUTPUT_MODE = "prompt";
 t.after(() => { if(priorMode === undefined) delete process.env.BASETEN_STRUCTURED_OUTPUT_MODE; else process.env.BASETEN_STRUCTURED_OUTPUT_MODE = priorMode; });
 const { compactUnderstandingSummary } = await import("@/features/sources/context/understanding");
 const valid = { purpose: "Track tasks", audience: "Teams", terminology: [], workflows: ["Edit tasks"], surfaces: ["Task detail"], gaps: [] };
 const prior = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "fixture";
 t.after(() => { if(prior === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = prior; });
 let content = "", calls = 0;
 t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ choices: [{ finish_reason: "stop", message: { content } }] }); });
 const run = () => generateStructured({ instructions: "Extract", input: "fixture", schema: compactUnderstandingSummary, invocation: { stage: "repository-understanding", operation: "repository-understanding" } });
 for (const [output, extraction, wrapper] of [
  [JSON.stringify(valid), "none", undefined],
  [JSON.stringify({...valid, $schema: "https://json-schema.org/draft/2020-12/schema"}), "none", undefined],
  [JSON.stringify({$schema: "https://json-schema.org/draft/2020-12/schema", result: {...valid, $schema: "https://json-schema.org/draft/2020-12/schema"}}), "none", "result"],
  ["```json\n"+JSON.stringify(valid)+"\n```", "fence", undefined],
  ["Result: "+JSON.stringify(valid), "surrounded", undefined],
  [JSON.stringify({result: valid}), "none", "result"],
  [JSON.stringify({analysis: {...valid, metadata: { private: "NOT_RETAINED" }}, metadata: {private: "NOT_RETAINED"}}), "none", "analysis"],
  [JSON.stringify({...valid, metadata:{private:"NOT_RETAINED"}}), "none", undefined],
 ] as const) {
  content = output; const result = await run();
  assert.deepEqual(result.data, valid);
  assert.equal(result.metadata?.boundary?.extraction, extraction);
  assert.equal(result.metadata?.boundary?.wrapper, wrapper);
  assert.equal(result.metadata?.boundary?.normalization, "accepted");
  const schemaMarkers = (output.match(/"\$schema":/g) ?? []).length;
  if (schemaMarkers) {
   assert.equal(result.metadata?.boundary?.ignoredCount, schemaMarkers);
   assert.ok(result.metadata?.boundary?.ignoredKeys.includes("$schema"));
  }
  assert.ok(!JSON.stringify(result.metadata).includes("NOT_RETAINED"));
 }
 for (const output of [
  {...valid, inventedCapability: "PRIVATE_SEMANTICS"},
  {...valid, $schema: { purpose: "PRIVATE_SEMANTICS" }},
  {...valid, $schema: "https://untrusted.example/schema"},
  {...valid, $schema: "https://json-schema.org/draft/2020-12/schema", inventedCapability: "PRIVATE_SEMANTICS"},
  {...valid, $schema: "https://json-schema.org/draft/2020-12/schema", purpose: 123},
  {result:valid, provenance:"PRIVATE_SEMANTICS"},
  {...valid, purpose: 123},
  {result: valid, analysis: valid},
  {result: valid, purpose: "Mixed roots"},
 ]) {
  content = JSON.stringify(output); const before = calls;
  await assert.rejects(run(), error => {
   assert.ok(error instanceof ModelError);
   assert.ok(error.diagnostic?.boundary?.rootShape?.expectedKeys.includes("purpose"));
   assert.ok(!JSON.stringify(error.diagnostic).includes("PRIVATE_SEMANTICS"));
   assert.ok(!JSON.stringify(error.diagnostic).includes("inventedCapability"));
   if (Object.hasOwn(output, "inventedCapability")) {
    assert.equal(error.diagnostic?.boundary?.rootShape?.withheldKeyCount, 1);
    assert.ok(error.diagnostic?.boundary?.rootShape?.receivedKeys.includes("purpose"));
   }
   assert.equal(error.diagnostic?.boundary?.canonical, "rejected");
   return true;
  });
  assert.equal(calls, before+1, "onboarding never retries rejected output");
 }
});

test("Muse Spark Open supplies schema in the prompt and retains strict semantic validation", async t => {
 const before={key:process.env.BASETEN_API_KEY,mode:process.env.BASETEN_STRUCTURED_OUTPUT_MODE};
 process.env.BASETEN_API_KEY="fixture";process.env.BASETEN_STRUCTURED_OUTPUT_MODE="auto";
 t.after(()=>{if(before.key===undefined)delete process.env.BASETEN_API_KEY;else process.env.BASETEN_API_KEY=before.key;if(before.mode===undefined)delete process.env.BASETEN_STRUCTURED_OUTPUT_MODE;else process.env.BASETEN_STRUCTURED_OUTPUT_MODE=before.mode;});
 const schema=z.object({value:z.string().min(1).max(20).refine(value=>value.trim().length>0)}).strict();
 let content='{"value":"ok"}',calls=0,status=200;
 t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
  calls++; const body=JSON.parse(String(init?.body));
  assert.equal(body.max_tokens,4096); assert.ok(body.messages[0].content.startsWith("Extract meaning only."));
  assert.equal(body.response_format,undefined);
  assert.ok(body.messages[0].content.includes(JSON.stringify(z.toJSONSchema(schema))));
  return Response.json({choices:[{finish_reason:"stop",message:{content}}]},{status});
 });
 const run=()=>generateStructured({instructions:"Extract meaning only.",input:"fixture",schema,invocation:{operation:"documentation-planning",stage:"offline"}});
 assert.deepEqual((await run()).data,{value:"ok"});
 for(content of ['{"value":" "}','{"value":3}']) {
  const prior=calls;await assert.rejects(run(),error=>error instanceof ModelError);assert.equal(calls,prior+1);
 }
 status=400;const prior=calls;await assert.rejects(run(),/invalid-request/);assert.equal(calls,prior+1,"provider rejection must not trigger another request");
});

test("provider capability and schema checks choose fallback before any request", async t => {
 const {basetenCapabilities,basetenStructuredOutput}=await import("./baseten/structured-output");
 const prior=process.env.BASETEN_STRUCTURED_OUTPUT_MODE;delete process.env.BASETEN_STRUCTURED_OUTPUT_MODE;
 t.after(()=>{if(prior===undefined)delete process.env.BASETEN_STRUCTURED_OUTPUT_MODE;else process.env.BASETEN_STRUCTURED_OUTPUT_MODE=prior;});
 const closed=z.toJSONSchema(z.object({value:z.string()}).strict());
 assert.equal(basetenCapabilities("meta-models/muse-spark-open-1026").nativeJsonSchema,false);
 assert.equal(basetenStructuredOutput("unsupported-model","source-analysis",closed).metadata.fallbackReason,"model-unsupported");
 const opaque=basetenStructuredOutput("meta-models/muse-spark-open-1026","documentation-transformation",z.toJSONSchema(z.object({entries:z.array(z.unknown())}).strict()));
 assert.equal(opaque.metadata.mode,"prompt");assert.equal(opaque.responseFormat,undefined);assert.equal(opaque.metadata.fallbackReason,"model-unsupported");
 const open=basetenStructuredOutput("meta-models/muse-spark-open-1026","source-analysis",z.toJSONSchema(z.object({value:z.string()}).passthrough()));assert.equal(open.metadata.mode,"prompt");
});

test("unsupported models use the existing prompt/extraction/wrapper path",async t=>{
 const prior={model:process.env.BASETEN_MODEL,key:process.env.BASETEN_API_KEY,mode:process.env.BASETEN_STRUCTURED_OUTPUT_MODE};
 process.env.BASETEN_MODEL="legacy-fixture-model";process.env.BASETEN_API_KEY="fixture";process.env.BASETEN_STRUCTURED_OUTPUT_MODE="auto";
 t.after(()=>{for(const [key,value] of Object.entries({BASETEN_MODEL:prior.model,BASETEN_API_KEY:prior.key,BASETEN_STRUCTURED_OUTPUT_MODE:prior.mode})){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));assert.equal(body.response_format,undefined);assert.equal(body.max_tokens,4096);
  assert.ok(body.messages[0].content.includes("Return only JSON matching this schema:"));
  return Response.json({choices:[{finish_reason:"stop",message:{content:'```json\n{"result":{"value":"ok"}}\n```'}}]});
 });
 const result=await generateStructured({...options,invocation:{operation:"documentation-planning",stage:"offline"}});
 assert.deepEqual(result.data,{value:"ok"});assert.equal(result.metadata?.boundary?.extraction,"fence");assert.equal(result.metadata?.boundary?.wrapper,"result");
});

test("Baseten accounts for actual reasoning and visible size without retaining hidden content", async t => {
  const previous = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "offline";
  t.after(() => { if (previous === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = previous; });
  const { invokeBaseten } = await import("./baseten/invoke");
  const { resolveInference } = await import("./operation-policy");
  const content = '{"value":"é"}';
  for (const finish of ["stop", "length"]) {
    t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.reasoning_effort, "low"); assert.equal(request.max_tokens, 4096);
      assert.equal(request.reasoning, undefined);
      return Response.json({ choices: [{ finish_reason: finish, message: { content, reasoning_content: "PRIVATE_REASONING" } }],
        usage: { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110,
          completion_tokens_details: { reasoning_tokens: 90, private_field: "PRIVATE_DETAILS" } } });
    });
    const call = invokeBaseten({ instructions: "Extract", input: "value", maxOutputTokens: 4096, settings: resolveInference("baseten", "runtime-decision") });
    const check = (metadata: import("./model-diagnostic").ModelInvocationMetadata | undefined) => {
      assert.equal(metadata?.usage?.completion_tokens, 100);
      assert.deepEqual(metadata?.usage?.completion_tokens_details, { reasoning_tokens: 90 });
      assert.deepEqual(metadata?.visibleResponse, { bytes: Buffer.byteLength(content), characters: content.length, jsonWhitespaceCharacters: 0, longestJsonWhitespaceRun: 0 });
      assert.equal(metadata?.reasoningEffort, "low"); assert.equal(metadata?.completionReason, finish);
      assert.ok(!JSON.stringify(metadata).includes("PRIVATE"));
    };
    if (finish === "stop") check((await call).metadata);
    else await assert.rejects(call, error => { check((error as import("./baseten/invoke").BasetenError).diagnostic); return true; });
  }
});

test("omitted, null or malformed reasoning details preserve available aggregate usage", async t => {
  const previous = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "offline";
  t.after(() => { if (previous === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = previous; });
  for (const details of [undefined, null, { reasoning_tokens: "unknown" }, { reasoning_tokens: -1 }, {}]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"value":"yes"}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20, completion_tokens_details: details } }));
    const result = await generateStructured(options);
    assert.equal(result.metadata?.usage?.completion_tokens, 8);
    assert.equal(result.metadata?.usage?.completion_tokens_details?.reasoning_tokens, undefined);
  }
});


test("response size diagnostics distinguish formatting padding from string contents without storing either", async () => {
  const { responseTextMetrics } = await import("./response-text-metrics");
  const text = '{"private":"a   b\\\" c"}' + " ".repeat(10_000);
  const metrics = responseTextMetrics(text);
  assert.equal(metrics.jsonWhitespaceCharacters, 10_000);
  assert.equal(metrics.longestJsonWhitespaceRun, 10_000);
  assert.ok(!JSON.stringify(metrics).includes("private"));
  assert.equal(responseTextMetrics('{"partial":"a   b').jsonWhitespaceCharacters, 0);
  assert.equal(responseTextMetrics('{\n  "value": "é"\n}').jsonWhitespaceCharacters, 5);
});
