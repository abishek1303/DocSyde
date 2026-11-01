import { test } from "node:test";
import assert from "node:assert/strict";
import { restorePublication } from "./restore-publication";

test("cleanup verifies absence and restores original even if the empty HTTP observation fails", async () => {
  let current: string | null = "scenario", observations = 0;
  const result = await restorePublication({ scenarioPublicationId: "scenario-id", originalDocumentId: "original", originalRemoved: true }, {
    remove: async id => { assert.equal(id, "scenario-id"); current = null; return true; }, currentDocument: async () => current,
    insert: async document => { assert.equal(current, null); current = document; return true; },
    deliveredDocument: async () => { if (++observations === 1) throw new Error("HTTP unavailable"); return current; }, event: async () => {},
  });
  assert.equal(current, "original"); assert.equal(result.restored, true); assert.equal(result.verified, false);
});
test("CAS conflict never overwrites another publication and does not claim restoration", async () => {
  let insertCalls = 0;
  const result = await restorePublication({ scenarioPublicationId: "ours", originalDocumentId: "original", originalRemoved: true }, {
    remove: async () => false, currentDocument: async () => "concurrent-document", insert: async () => { insertCalls++; return false; },
    deliveredDocument: async () => "concurrent-document", event: async () => {},
  });
  assert.equal(insertCalls, 1); assert.equal(result.restored, false); assert.equal(result.verified, false);
});
test("an originally empty route stays empty after removing only the scenario association", async () => {
  let current: string | null = "scenario";
  const result = await restorePublication({ scenarioPublicationId: "ours", originalDocumentId: null, originalRemoved: false }, {
    remove: async () => { current = null; return true; }, currentDocument: async () => current,
    insert: async () => { throw new Error("No original to restore"); }, deliveredDocument: async () => current, event: async () => {},
  });
  assert.deepEqual(result, { restored: true, verified: true, issues: [] });
});
