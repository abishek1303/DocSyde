import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertDocsydeIdentity, currentDocsydeIdentity } from "@/integrations/reliability/docsyde-identity";
const expected = { version: 1 as const, experimentId: "fixture", scenario: "A" as const, docsydeSha: "a".repeat(40), token: randomUUID(), pid: 123,
  databaseName: "docsyde_reliability_fixture_a", buildId: "build-one" };
test("server identity requires exact process, nonce, build, checkout, experiment, scenario and database", () => {
  assert.doesNotThrow(() => assertDocsydeIdentity(expected, expected));
  for (const [key, value] of Object.entries({ experimentId: "other", scenario: "B", docsydeSha: "b".repeat(40), token: randomUUID(), pid: 456,
    databaseName: "docsyde", buildId: "build-two" })) {
    assert.throws(() => assertDocsydeIdentity({ ...expected, [key]: value }, expected));
  }
  assert.throws(() => assertDocsydeIdentity({ ready: true }, expected));
});
test("ordinary/offline server cannot expose a reliability identity or touch the database", async () => {
  await assert.rejects(currentDocsydeIdentity(null));
  await assert.rejects(currentDocsydeIdentity(randomUUID()));
});
