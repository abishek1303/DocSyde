import { z } from "zod";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { visualEvidenceJsonSchema, visualEvidenceSchema } from "@/integrations/ai/visual-evidence";

type Options = Parameters<typeof import("./invoke-vision").invokeMetaVision>[0];
const options: Options = { png: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]), context: "Inspect visible controls", instructions: "Visible evidence only" };
const valid = { model: "muse-spark-1.3", choices: [{ finish_reason: "stop", message: { content: "{}" } }] };
function configure(t: TestContext, values = { META_API_KEY: "private-key", META_VISION_MODEL: "muse-spark-1.3" }) {
  for (const [name, value] of Object.entries(values)) {
    const previous = process.env[name]; process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
}
async function invoke(input: Options = options) {
  const { invokeMetaVision } = await import("./invoke-vision");
  return invokeMetaVision(input);
}

test("Meta key is required lazily; model defaults unless explicitly overridden", async t => {
  configure(t, { META_API_KEY: "", META_VISION_MODEL: "" });
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected request"); });
  await import("./invoke-vision");
  await assert.rejects(invoke(), { code: "missing-credentials" });
  process.env.META_API_KEY = " \t";
  await assert.rejects(invoke(), { code: "missing-credentials" });
  assert.equal(fetch.mock.callCount(), 0);
  process.env.META_API_KEY = "private-key";
  for (const override of [undefined, "", " \n", " custom-vision-model "]) {
    if (override === undefined) delete process.env.META_VISION_MODEL;
    else process.env.META_VISION_MODEL = override;
    const expected = override?.trim() || "muse-spark-1.3";
    fetch.mock.mockImplementation(async (_url: unknown, init?: RequestInit) => {
      assert.ok(init);
      assert.equal(JSON.parse(String(init.body)).model, expected);
      return Response.json({ ...valid, model: expected });
    });
    const result = await invoke();
    assert.equal(result.model, expected); assert.equal(result.text, "{}");
    assert.equal(result.metadata.completionReason, "stop");
    assert.equal(typeof result.metadata.elapsedMs, "number");
  }
  assert.equal(fetch.mock.callCount(), 4);
});

test("Meta request uses bearer auth, bounded deadline, no streaming and exactly one request", async t => {
  configure(t);
  const timeout = t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    assert.equal(milliseconds, 120_000); return new AbortController().signal;
  });
  const fetch = t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    assert.equal(url, "https://api.meta.ai/v1/chat/completions");
    assert.deepEqual(init.headers, { Authorization: "Bearer private-key", "Content-Type": "application/json" });
    assert.equal(init.method, "POST"); assert.equal(init.redirect, "error");
    const body = JSON.parse(String(init.body));
    assert.equal(body.stream, false); assert.equal(body.max_completion_tokens, 4096);
    assert.deepEqual(body.response_format, { type: "json_schema", json_schema: {
      name: "VisualEvidence", strict: true, schema: visualEvidenceJsonSchema,
    } });
    const schema = body.response_format.json_schema.schema;
    // Validate the actual serialized schema, not just the exported constant.
    const strictSubset = (node: Record<string, unknown>, root = false) => {
      assert.equal(node.oneOf, undefined); assert.equal(node.allOf, undefined);
      if (root) { assert.equal(node.type, "object"); assert.equal(node.anyOf, undefined); }
      if (node.type === "object") {
        assert.equal(node.additionalProperties, false);
        const properties = node.properties as Record<string, Record<string, unknown>>;
        assert.deepEqual([...(node.required as string[])].sort(), Object.keys(properties).sort());
        Object.values(properties).forEach(child => strictSubset(child));
      }
      if (node.items) strictSubset(node.items as Record<string, unknown>);
      if (node.anyOf) (node.anyOf as Record<string, unknown>[]).forEach(child => strictSubset(child));
    };
    strictSubset(schema, true);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.elements.maxItems, 20);
    assert.equal(schema.properties.observations.maxItems, 10);
    assert.equal(schema.properties.limitations.maxItems, 10);
    const variants = schema.properties.elements.items.anyOf;
    assert.equal(variants.length, 3);
    for (const element of variants) {
      assert.equal(element.additionalProperties, false);
      assert.deepEqual(element.required, ["description", "visibleText", "bounds", "certainty"]);
    }
    assert.equal(variants[0].properties.certainty.const, "uncertain");
    assert.deepEqual(variants[0].properties.bounds, { type: "null" });
    assert.equal(variants[1].properties.certainty.const, "clear");
    assert.deepEqual(variants[1].properties.bounds, { type: "null" });
    assert.equal(variants[2].properties.certainty.const, "clear");
    const box = variants[2].properties.bounds;
    assert.equal(box.additionalProperties, false);
    for (const edge of ["xMin", "yMin", "xMax", "yMax"]) {
      assert.deepEqual(box.properties[edge], { type: "number", minimum: 0, maximum: 1 });
    }
    const remote = z.fromJSONSchema(schema);
    const located = { description: "Visible control", visibleText: null, certainty: "clear", bounds: { xMin: 0, yMin: 0, xMax: 1, yMax: 1 } };
    const evidence = (element: unknown) => ({ elements: [element], observations: [], limitations: [] });
    for (const [value, accepted] of [
      [{ ...located, certainty: "uncertain", bounds: null }, true],
      [{ ...located, bounds: null }, true], [located, true],
      [{ ...located, certainty: "uncertain" }, false],
      [{ ...located, certainty: "verified" }, false],
      [{ ...located, bounds: { ...located.bounds, xMin: -1 } }, false],
      [{ ...located, bounds: { xMin: 0 } }, false],
      [{ description: "Missing fields" }, false],
      [null, false],
    ] as const) {
      assert.equal(remote.safeParse(evidence(value)).success, accepted);
      assert.equal(visualEvidenceSchema.safeParse(evidence(value)).success, accepted);
    }
    // Relative edge ordering cannot be expressed by this supported subset.
    const reversed = evidence({ ...located, bounds: { ...located.bounds, xMin: 1, xMax: 0 } });
    assert.equal(remote.safeParse(reversed).success, true);
    assert.equal(visualEvidenceSchema.safeParse(reversed).success, false);
    assert.equal(body.messages[1].content[1].image_url.url, `data:image/png;base64,${Buffer.from(options.png).toString("base64")}`);
    return Response.json(valid);
  });
  await invoke(); assert.equal(fetch.mock.callCount(), 1); assert.equal(timeout.mock.callCount(), 1);
});

test("HTTP auth, billing, access, model, rate-limit and upstream failures stay sanitized", async t => {
  configure(t);
  for (const [status, code] of [[400, "invalid-request"], [401, "unauthorized"], [402, "billing"],
    [403, "forbidden"], [404, "model-unavailable"], [413, "invalid-request"], [429, "rate-limited"], [500, "upstream"]] as const) {
    const fetch = t.mock.method(globalThis, "fetch", async () => new Response("private-key data:image/png;base64,secret raw body", { status, headers: { "retry-after": "12" } }));
    await assert.rejects(invoke(), error => {
      assert.ok(error instanceof Error && "code" in error && "retryAfterSeconds" in error);
      assert.equal(error.code, code); assert.equal(error.retryAfterSeconds, 12);
      assert.ok(!error.message.includes("private-key")); assert.ok(!error.message.includes("data:"));
      assert.ok(!error.message.includes("raw body")); return true;
    });
    assert.equal(fetch.mock.callCount(), 1); fetch.mock.restore();
  }
});

test("network errors do not expose request details or retry", async t => {
  configure(t);
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Authorization private-key data:image/png;base64,private"); });
  await assert.rejects(invoke(), error => {
    assert.ok(error instanceof Error && "code" in error); assert.equal(error.code, "upstream");
    assert.equal(error.message, "Meta vision request failed: upstream"); return true;
  });
  assert.equal(fetch.mock.callCount(), 1);
});

test("invalid envelopes, refusals and incomplete output are distinct", async t => {
  configure(t);
  for (const [response, code] of [
    [{}, "invalid-response"],
    [{ ...valid, choices: [] }, "invalid-response"],
    [{ ...valid, choices: [...valid.choices, ...valid.choices] }, "invalid-response"],
    [{ ...valid, model: 3 }, "invalid-response"],
    [{ ...valid, choices: [{ finish_reason: "stop", message: { content: 3 } }] }, "invalid-response"],
    [{ ...valid, choices: [{ finish_reason: "stop", message: { refusal: "private refusal" } }] }, "refused"],
    [{ ...valid, choices: [{ finish_reason: "content_filter", message: { content: null } }] }, "refused"],
    [{ ...valid, choices: [{ finish_reason: "length", message: { content: "partial" } }] }, "incomplete-output"],
    [{ ...valid, choices: [{ finish_reason: "stop", message: { content: null } }] }, "incomplete-output"],
    [{ ...valid, choices: [{ finish_reason: "tool_calls", message: {} }] }, "incomplete-output"],
  ] as const) {
    const mock = t.mock.method(globalThis, "fetch", async () => Response.json(response));
    await assert.rejects(invoke(), { code }); mock.mock.restore();
  }
  t.mock.method(globalThis, "fetch", async () => new Response("not JSON", { status: 200 }));
  await assert.rejects(invoke(), { code: "invalid-response" });
});

test("caller cancellation interrupts an in-flight request with sanitized cancellation", async t => {
  configure(t);
  const controller = new AbortController();
  const fetch = t.mock.method(globalThis, "fetch", (_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    assert.ok(init.signal);
    init.signal.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    controller.abort(new Error("private abort reason"));
  }));
  await assert.rejects(invoke({ ...options, signal: controller.signal }), { code: "cancelled" });
  assert.equal(fetch.mock.callCount(), 1);
});

test("pre-cancelled request does not encode or call fetch", async t => {
  configure(t);
  const controller = new AbortController(); controller.abort(new Error("private abort reason"));
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected request"); });
  await assert.rejects(invoke({ ...options, signal: controller.signal }), { code: "cancelled" });
  assert.equal(fetch.mock.callCount(), 0);
});

test("deadline abort is distinguished from caller cancellation", async t => {
  configure(t);
  const deadline = new AbortController();
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => { assert.equal(milliseconds, 120_000); return deadline.signal; });
  t.mock.method(globalThis, "fetch", (_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    assert.ok(init.signal);
    init.signal.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    deadline.abort();
  }));
  await assert.rejects(invoke(), { code: "timeout" });
});
