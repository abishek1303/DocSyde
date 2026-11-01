import { test } from "node:test";
import assert from "node:assert/strict";
import { boundInspectionContext, readInspectionContext } from "./read-inspection-context";
import type { ContextFile } from "./source-context";
const head = "a".repeat(40);
const file = (path: string, text: string): ContextFile => ({ path, text, status: "available", contentId: null, size: Buffer.byteLength(text), url: "https://github.com/example/product" });
test("explicit context includes only whole files within 16 KiB, preserving pinned identity and unavailable states", () => {
  const missing: ContextFile = { path: "missing.ts", status: "unavailable", reason: "missing", contentId: null, size: null, url: "" };
  const result = boundInspectionContext([file("small.ts", "a".repeat(1024)), file("large.ts", "b".repeat(16 * 1024)), missing], head);
  assert.equal(result[0].commitId, head); assert.equal(result[0].text?.length, 1024);
  assert.equal(result[1].status, "oversized"); assert.equal(result[1].text, null);
  assert.equal(result[2].status, "missing-or-unsupported");
  assert.throws(() => boundInspectionContext(Array.from({length:4}, () => missing), head), /three files/);
});
test("invalid/duplicate supporting paths and cancellation fail before network reads", async () => {
  const input = {owner:"example",repo:"product",head}; const signal = new AbortController().signal;
  await assert.rejects(readInspectionContext(input, ["a", "a"], signal), /unique/);
  await assert.rejects(readInspectionContext(input, ["../secret"], signal));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(readInspectionContext(input, [], abort.signal));
});
