import { test } from "node:test";
import assert from "node:assert/strict";
import { createRepositoryContextRequests } from "./components/repository-context-requests";
test("late load/save/clear responses are stale after replacement or repository unmount", async () => {
  for (const operation of ["load", "save", "clear"]) {
    const a = createRepositoryContextRequests(), b = createRepositoryContextRequests();
    const ticket = a.begin(); let deliver!: () => void;
    const response = new Promise<void>(resolve => { deliver = resolve; });
    let displayed = "Repository B";
    const pending = response.then(() => { if (a.isCurrent(ticket)) displayed = operation; });
    a.cancel(); const bTicket = b.begin(); deliver(); await pending;
    assert.equal(displayed, "Repository B"); assert.equal(b.isCurrent(bTicket), true);
    const next = b.begin(); assert.equal(b.isCurrent(bTicket), false); assert.equal(b.isCurrent(next), true);
  }
});
