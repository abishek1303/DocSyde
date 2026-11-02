import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { resolveInference, inferenceSnapshot, basetenInferenceFields } from "./operation-policy";
import { generateStructured } from "./generate-structured";

test("operation ceilings stay intentional with omitted reasoning and sampling", t => {
  const previous = process.env.BASETEN_MODEL; delete process.env.BASETEN_MODEL;
  t.after(() => { if (previous === undefined) delete process.env.BASETEN_MODEL; else process.env.BASETEN_MODEL = previous; });
  for (const [operation, ceiling] of Object.entries({ "source-analysis":8192, "source-summary":8192, "runtime-decision":4096, "visual-selection":3072, "product-impact":8192, "documentation-planning":4096, "documentation-draft":8192, "documentation-transformation":8192, "transformation-support":8192 })) {
    const settings = resolveInference("baseten", operation);
    assert.equal(settings.maxOutputTokens, ceiling); assert.deepEqual(basetenInferenceFields(settings), {});
    assert.equal(inferenceSnapshot(operation, settings).reasoningEffort, null);
  }
  assert.deepEqual(basetenInferenceFields(resolveInference("baseten", "source-analysis", undefined, { temperature: undefined })), {});
});

test("unconfirmed model controls and arbitrary provider options reject before fetch", async t => {
  const previous = process.env.BASETEN_MODEL; delete process.env.BASETEN_MODEL;
  t.after(() => { if (previous === undefined) delete process.env.BASETEN_MODEL; else process.env.BASETEN_MODEL = previous; });
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("No inference permitted"); });
  const options = { instructions: "Extract", input: "value", schema: z.object({ value:z.string() }) };
  for (const inference of [{ reasoningEffort:"low" }, { temperature:0.8 }, { topP:0.9 }, { top_k:3 }, { temperature:NaN }, { topP:0 }]) {
    await assert.rejects(generateStructured({ ...options, inference } as Parameters<typeof generateStructured>[0]), /unsupported-options/);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test("confirmed canonical Muse fields serialize exactly without leaking unrelated options", async t => {
  const previous = { BASETEN_MODEL:process.env.BASETEN_MODEL, BASETEN_API_KEY:process.env.BASETEN_API_KEY };
  process.env.BASETEN_MODEL = "meta-models/muse-spark-open"; process.env.BASETEN_API_KEY = "fixture";
  t.after(() => { for (const [key,value] of Object.entries(previous)) { if (value===undefined) delete process.env[key]; else process.env[key]=value; } });
  t.mock.method(console,"warn",()=>{});
  const fetch = t.mock.method(globalThis,"fetch",async (_url: unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    assert.equal(body.model,"meta-models/muse-spark-open"); assert.equal(body.max_tokens,1234);
    assert.equal(body.reasoning_effort,"medium"); assert.equal(body.temperature,0.7); assert.equal(body.top_p,0.8);
    assert.equal("inference" in body,false); assert.equal("chat_template_kwargs" in body,false);
    return Response.json({choices:[{finish_reason:"stop",message:{content:'{"value":"ok"}'}}]});
  });
  const result=await generateStructured({instructions:"Extract",input:"value",schema:z.object({value:z.string()}),maxOutputTokens:1234,inference:{reasoningEffort:"medium",temperature:0.7,topP:0.8}});
  assert.equal(result.data.value,"ok"); assert.equal(fetch.mock.callCount(),1);
});

test("all Baseten operation request shapes are unchanged except selection's explicit ceiling/revision", async t => {
  const previous = { BASETEN_MODEL: process.env.BASETEN_MODEL, BASETEN_API_KEY: process.env.BASETEN_API_KEY };
  delete process.env.BASETEN_MODEL; process.env.BASETEN_API_KEY = "offline";
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  t.mock.method(console, "warn", () => {});
  for (const [operation, max] of Object.entries({ "source-analysis": 8192, "source-summary": 8192, "runtime-decision": 4096, "visual-selection": 3072, "product-impact": 8192, "documentation-planning": 4096, "documentation-draft": 8192, "documentation-transformation": 8192, "transformation-support": 8192, "receipt-verification": 4096 })) {
    const schema = z.object({ value: z.string() }).strict();
    t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
      assert.equal(String(url), "https://inference.baseten.co/v1/chat/completions");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        model: "meta-models/muse-spark-open-1026", stream: false, max_tokens: max,
        messages: [{ role: "system", content: `Extract\nReturn only JSON matching this schema: ${JSON.stringify(z.toJSONSchema(schema))}` }, { role: "user", content: "value" }],
      });
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"value":"ok"}' } }] });
    });
    await generateStructured({ instructions: "Extract", input: "value", schema, invocation: { operation, stage: "offline" } });
  }
});
