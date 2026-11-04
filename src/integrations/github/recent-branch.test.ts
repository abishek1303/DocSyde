import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

let previousRepository: string | undefined;
beforeEach(() => {
  previousRepository = process.env.DOCSYDE_ANALYSIS_REPOSITORIES;
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "example/product";
});
afterEach(() => {
  if (previousRepository === undefined) delete process.env.DOCSYDE_ANALYSIS_REPOSITORIES;
  else process.env.DOCSYDE_ANALYSIS_REPOSITORIES = previousRepository;
});
import { readRecentBranchSelection } from "./recent-branch";

test("automatic branch selection checks every page, picks the newest tip and prefers the default on ties", async t => {
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "fixture";
  t.after(() => { if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous; });
  let calls = 0, tied = false, broken = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname === "/repos/example/product") return Response.json({ full_name: "example/product" });
    assert.equal(url.href, "https://api.github.com/graphql");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body));
    const second = body.variables.after === "page-2";
    calls++;
    return Response.json({ data: { repository: { defaultBranchRef: { name: "main" }, refs: {
      nodes: second ? [{ name: "feature/latest", target: { messageHeadline: "feat: Improve request creation", committedDate: tied ? "2026-10-30T12:00:00Z" : "2026-10-31T12:00:00Z" } }] : [{ name: "main", target: { messageHeadline: "feat: Improve request creation", committedDate: "2026-10-30T12:00:00Z" } }],
      pageInfo: { hasNextPage: !second || broken, endCursor: "page-2" },
    } } } });
  });
  const recent = await readRecentBranchSelection("example", "product");
  assert.equal(recent.selected, "feature/latest");
  assert.deepEqual(recent.names, ["feature/latest", "main"]);
  assert.equal(calls, 2);
  assert.deepEqual(recent.changes[0], { branch: "feature/latest", title: "feat: Improve request creation" });
  tied = true;
  assert.equal((await readRecentBranchSelection("example", "product")).selected, "main");
  broken = true;
  await assert.rejects(() => readRecentBranchSelection("example", "product"), /incomplete/);
});
