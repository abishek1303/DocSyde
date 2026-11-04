import React from "react";
import Module, { createRequire } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { PendingWorkspace } from "../../review/pending-workspace";

test("each pending page reports its own total and included counts", async t => {
  const load = createRequire(import.meta.url);
  const replacements = [
    ["next/navigation", { useRouter: () => ({ push() {}, refresh() {} }) }],
    ["../../review/pending-workspace-actions", {}],
  ] as const;
  for (const [path, exports] of replacements) {
    const resolved = load.resolve(path), previous = load.cache[resolved];
    const stub = new Module(resolved); stub.exports = exports; load.cache[resolved] = stub;
    t.after(() => { if (previous) load.cache[resolved] = previous; else delete load.cache[resolved]; });
  }
  const { PendingPublishWorkspace } = await import("./pending-publish-workspace");
  const group: PendingWorkspace["groups"][number] = { key: "page-a", title: "First page", routes: ["/first"], baseline: null, conflictKey: null, versions: [], document: null, images: [], imageSources: {}, highlighted: [], issue: null,
    changes: [false, true].map((excluded, index) => ({ key: `change-${index}`, label: "Update", reason: "Changed", warnings: [], unavailable: null, excluded, issue: null, proposalId: "proposal-a" })) };
  const initial: PendingWorkspace = { repository: "example/product", hash: "a".repeat(64), count: 2, blocked: false, groups: [group, { ...group, key: "page-b", title: "Second page", changes: [{ ...group.changes[0], key: "change-2" }] }] };
  const html = renderToStaticMarkup(<PendingPublishWorkspace initial={initial} />);
  assert.match(html, /2 changes · 1 included/);
  assert.match(html, /1 change · 1 included/);
  assert.match(html, /Publish 2 changes/);
  const conflict = renderToStaticMarkup(<PendingPublishWorkspace initial={{ ...initial, blocked: true, groups: initial.groups.map(group => ({ ...group, conflictKey: "same-route" })) }} />);
  assert.match(conflict, /3 changes · 2 included/);
});
