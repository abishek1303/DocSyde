import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { invokeMetaComposition, MetaCompositionError } from "./invoke-composition";
import { compositionOutputSchema } from "../composition-output";
import { safeMetaProviderError } from "./provider-error";

function credentials(t: TestContext) {
  const oldKey = process.env.META_API_KEY, oldModel = process.env.META_COMPOSITION_MODEL;
  process.env.META_API_KEY = "PRIVATE_CREDENTIAL";
  process.env.META_COMPOSITION_MODEL = "muse-wonder-1.0";
  t.after(() => { for (const [key, value] of [["META_API_KEY", oldKey], ["META_COMPOSITION_MODEL", oldModel]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
}
// Meta strict subset: https://dev.meta.ai/docs/structured-output#enforce-strict-mode
function strictSubset(raw: unknown, root = true) {
  assert.ok(raw && typeof raw === "object" && !Array.isArray(raw));
  const schema = raw as Record<string, unknown>;
  assert.equal(schema.oneOf, undefined, "oneOf produces HTTP 400 with strict:true");
  assert.equal(schema.allOf, undefined);
  if (root) { assert.equal(schema.type, "object"); assert.equal(schema.anyOf, undefined); }
  if (schema.type === "object") {
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual([...(schema.required as string[])].sort(), Object.keys(schema.properties as object).sort());
  }
  for (const [key, value] of Object.entries(schema)) {
    if (["properties", "$defs", "definitions"].includes(key)) for (const child of Object.values(value as object)) strictSubset(child, false);
    else if (key === "items") strictSubset(value, false);
    else if (key === "anyOf") for (const child of value as unknown[]) strictSubset(child, false);
  }
}

test("Wonder serializes documented Chat Completions fields and a strict-compatible bounded schema", async t => {
  credentials(t);
  const schema = z.toJSONSchema(compositionOutputSchema);
  strictSubset(schema);
  // Reproduce the saved run's offending nested discriminated union, offline.
  const historical = JSON.parse(JSON.stringify(schema).replaceAll('"anyOf":', '"oneOf":'));
  assert.throws(() => strictSubset(historical), /oneOf produces HTTP 400/);
  const fetch = t.mock.method(globalThis, "fetch", async (url: unknown, options?: RequestInit) => {
    assert.equal(url, "https://api.meta.ai/v1/chat/completions");
    assert.deepEqual(JSON.parse(String(options?.body)), {
      model: "muse-wonder-1.0", stream: false, max_completion_tokens: 4096,
      response_format: { type: "json_schema", json_schema: { name: "DocumentationComposition", strict: true, schema } },
      messages: [{ role: "developer", content: "Edit grounded copy." }, { role: "user", content: "{}" }],
    });
    return Response.json({ model: "muse-wonder-1.0", choices: [{ finish_reason: "stop", message: { content: "{}" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  });
  const result = await invokeMetaComposition({ input: "{}", instructions: "Edit grounded copy.", schema });
  assert.equal(result.metadata.usage?.prompt_tokens, 10);
  assert.equal(fetch.mock.callCount(), 1);
  process.env.META_COMPOSITION_MODEL = "configured-editor";
  t.mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) => {
    assert.equal(JSON.parse(String(options?.body)).model, "configured-editor");
    return Response.json({ model: "configured-editor", choices: [{ finish_reason: "stop", message: { content: "{}" } }] });
  });
  assert.equal((await invokeMetaComposition({ input: "{}", instructions: "Edit.", schema })).model, "configured-editor");
});

test("HTTP 400 retains only closed-vocabulary diagnostics, preserves classification and never retries", async t => {
  credentials(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ error: {
    type: "invalid_request_error", code: "invalid_json_schema", param: "response_format",
    message: "Strict schema oneOf is not supported: rejected PRIVATE_VALUE Bearer PRIVATE_CREDENTIAL", input: "PRIVATE_SOURCE",
  } }, { status: 400 }));
  await assert.rejects(invokeMetaComposition({ input: "PRIVATE_SOURCE", instructions: "Edit.", schema: z.toJSONSchema(compositionOutputSchema) }), error => {
    assert.ok(error instanceof MetaCompositionError);
    assert.equal(error.code, "invalid-request");
    assert.deepEqual(error.diagnostic?.providerError, { httpStatus: 400, type: "invalid_request_error", code: "invalid_json_schema", parameter: "response_format", message: "Strict JSON schema does not support oneOf or allOf." });
    assert.ok(!JSON.stringify(error).includes("PRIVATE"));
    return true;
  });
  assert.equal(fetch.mock.callCount(), 1);
});

for (const body of ["PRIVATE_NON_JSON", "x".repeat(17000), JSON.stringify({ error: { type: "PRIVATE_TYPE", code: "PRIVATE_CODE", param: "PRIVATE_PARAMETER", message: "PRIVATE_VALUE" } })]) test("unknown and malformed errors withhold provider values", async () => {
  const diagnostic = await safeMetaProviderError(new Response(body, { status: 400 }));
  assert.deepEqual(diagnostic, { httpStatus: 400, type: null, code: null, parameter: null, message: "Provider error details withheld." });
});

test("oversized streamed errors stop reading and cancel without retaining a partial message", async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(17000)); }, cancel() { cancelled = true; } });
  const diagnostic = await safeMetaProviderError(new Response(body, { status: 503 }));
  assert.equal(diagnostic.httpStatus, 503); assert.equal(diagnostic.message, "Provider error details withheld."); assert.equal(cancelled, true);
});
