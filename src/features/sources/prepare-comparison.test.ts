import assert from "node:assert/strict";
import { test } from "node:test";
import { previewSourceComparison } from "./prepare-comparison";

const base = "a".repeat(40), head = "b".repeat(40);
function commit(sha: string) {
  return { sha, commit: { message: "Test change", author: { name: "Test" }, committer: { date: "2026-10-30T12:00:00Z" } } };
}
test("comparison preparation authorizes before provider access and never invokes inference", async t => {
  const env = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, DOCSYDE_ANALYSIS_REPOSITORIES: process.env.DOCSYDE_ANALYSIS_REPOSITORIES };
  process.env.GITHUB_TOKEN = "test-token";
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "example/product";
  t.after(() => { for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const calls: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, "https://api.github.com");
    calls.push(url);
    const body = url.pathname.endsWith("/commits/main") ? commit(head) : url.pathname.endsWith("/commits/before") ? commit(base) : {
      status: "ahead", merge_base_commit: commit(base), total_commits: 1, commits: [commit(head)],
      files: [{ filename: "src/page.tsx", status: "modified", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-old\n+new" }],
    };
    return Response.json(body);
  });
  await assert.rejects(() => previewSourceComparison({ owner: "denied", repo: "product", base: "before", head: "main" }), /not allowed/);
  assert.equal(calls.length, 0);
  const result = await previewSourceComparison({ owner: "example", repo: "product", base: "before", head: "main" });
  assert.equal(result.base, base); assert.equal(result.head, head);
  assert.equal(result.files[0].patch, "@@ -1 +1 @@\n-old\n+new");
  assert.equal(result.commits, 1);
  assert.equal(calls.length, 3);
  assert.ok(calls.some(url => url.pathname.endsWith(`/compare/${base}...${head}`)));
});
