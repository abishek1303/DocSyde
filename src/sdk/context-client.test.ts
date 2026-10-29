import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHostContext, createDocsydeClient } from "@/sdk/context-client";
test("SDK context validation and SSR-safe import", () => {
  const input = { version: 1, applicationId: "host", route: "/settings", featureIds: ["billing"] };
  const parsed = parseHostContext(input); parsed.featureIds.push("other"); assert.equal(input.featureIds.length, 1);
  assert.throws(() => parseHostContext({ ...input, route: "/?token=secret" }));
  assert.throws(() => createDocsydeClient({ applicationId: "host" }), /browser/);
});
test("rejects invalid host IDs, feature arrays and external routes", () => {
  for (const patch of [{ applicationId: "" }, { featureIds: [2] }, { route: "//external" }, { version: 2 }]) {
    assert.throws(() => parseHostContext({ version: 1, applicationId: "host", route: "/", featureIds: [], ...patch }));
  }
});
