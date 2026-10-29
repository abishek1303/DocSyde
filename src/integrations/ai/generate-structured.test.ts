import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { generateStructured } from "@/integrations/ai/generate-structured";
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
