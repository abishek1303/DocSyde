import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";

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
    assert.deepEqual(await invoke(), { model: expected, text: "{}" });
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
