import { test } from "node:test";
import assert from "node:assert/strict";
import { comparisonBase, readSelectedChange } from "./selected-change";
test("normal, merge and root comparisons use an explicit first parent", () => {
  assert.equal(comparisonBase(["a"]), "a");
  assert.equal(comparisonBase(["a", "b"]), "a");
  assert.equal(comparisonBase([]), null);
});
test("selected changes enforce source access before provider requests", async () => {
  await assert.rejects(() => readSelectedChange({ owner: "not-allowed", repo: "private" }, "a".repeat(40)), /not allowed/);
});
