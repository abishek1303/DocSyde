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
      assert.ok(!JSON.parse(String(init.body)).response_format);
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
