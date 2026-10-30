import { test } from "node:test";
import assert from "node:assert/strict";
import { getBasetenBilling } from "./billing";

const range = { startDate: "2026-10-01T00:00:00Z", endDate: "2026-10-29T00:00:00Z" };

test("billing maps gross, applied credits and net without inventing a balance", async (t) => {
  const previous = process.env.BASETEN_API_KEY;
  process.env.BASETEN_API_KEY = "test-key";
  t.after(() => { if (previous === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = previous; });
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    assert.equal(url.origin, "https://api.baseten.co");
    assert.equal(url.searchParams.get("start_date"), range.startDate);
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    return Response.json({ model_apis_usage: { total: "1.25", credits_used: "1", subtotal: "0.25" } });
  });
  const result = await getBasetenBilling({ ...range, startingCreditsUsd: 100 });
  assert.equal(result.grossCost, 1.25);
  assert.equal(result.creditsUsed, 1);
  assert.equal(result.costAfterCredits, 0.25);
  assert.equal(result.remainingCredits, null);
  assert.equal(result.estimatedRemainingCredits, 98.75);
  assert.equal(result.categories.training, null);
});

test("unavailable usage stays unknown", async (t) => {
  const previous = process.env.BASETEN_API_KEY;
  process.env.BASETEN_API_KEY = "test-key";
  t.after(() => { if (previous === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = previous; });
  t.mock.method(globalThis, "fetch", async () => Response.json({}));
  assert.equal((await getBasetenBilling(range)).grossCost, null);
});

test("invalid ranges and missing credentials fail before making requests", async (t) => {
  const previous = process.env.BASETEN_API_KEY;
  delete process.env.BASETEN_API_KEY;
  t.after(() => { if (previous !== undefined) process.env.BASETEN_API_KEY = previous; });
  const mock = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected request"); });
  for (const options of [{ ...range, startDate: "bad" }, { ...range, endDate: range.startDate }, { ...range, endDate: "2026-12-01T00:00:00Z" }]) {
    await assert.rejects(getBasetenBilling(options), /invalid-date-range/);
  }
  await assert.rejects(getBasetenBilling(range), /missing-credentials/);
  assert.equal(mock.mock.callCount(), 0);
});

test("provider failures and malformed amounts are sanitized", async (t) => {
  const previous = process.env.BASETEN_API_KEY;
  process.env.BASETEN_API_KEY = "test-key";
  t.after(() => { if (previous === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = previous; });
  for (const status of [401, 403, 429, 500]) {
    t.mock.method(globalThis, "fetch", async () => new Response("secret-response", { status }));
    await assert.rejects(getBasetenBilling(range), new RegExp(`billing-http-${status}`));
  }
  t.mock.method(globalThis, "fetch", async () => Response.json({ model_apis_usage: { total: "", credits_used: "0", subtotal: "0" } }));
  await assert.rejects(getBasetenBilling(range), /invalid-billing-response/);
});
