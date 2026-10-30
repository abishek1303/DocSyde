import { test } from "node:test";
import assert from "node:assert/strict";
import { readRecentCommits } from "./browse";

test("recent commits resolve the default branch, honor selected branches and handle empty repositories", async t => {
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-token";
  t.after(() => { if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous; });
  let empty = false;
  const refs: string[] = [];
  const pages: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    if (url.pathname.endsWith("/commits")) {
      if (empty) return Response.json({ message: "Git Repository is empty." }, { status: 409 });
      refs.push(url.searchParams.get("sha") ?? "");
      pages.push(url.searchParams.get("page") ?? "");
      return Response.json([{ sha: "a".repeat(40), html_url: "https://github.com/example/product/commit/a", commit: { message: "Short title\nBody", author: { name: "Author" }, committer: { date: "2026-10-29T00:00:00Z" } } }], { headers: url.searchParams.get("page") === "1" ? { link: '<https://api.github.com/repos/example/product/commits?page=2>; rel="next"' } : {} });
    }
    return Response.json({ default_branch: "main", size: empty ? 0 : 10 });
  });
  const first = await readRecentCommits({ owner: "example", repo: "product" }, undefined, 4);
  assert.equal(first.branch, "main");
  assert.equal(first.commits[0].message, "Short title");
  await readRecentCommits({ owner: "example", repo: "product" }, "release/test", 4);
  assert.deepEqual(refs, ["main", "release/test"]);
  assert.equal(first.hasNext, true);
  assert.equal((await readRecentCommits({ owner: "example", repo: "product" }, "release/test", 4, 2)).hasNext, false);
  assert.deepEqual(pages, ["1", "1", "2"]);
  await assert.rejects(() => readRecentCommits({ owner: "example", repo: "product" }, "main", 20, 0));
  empty = true;
  assert.deepEqual((await readRecentCommits({ owner: "example", repo: "product" })).commits, []);
  await assert.rejects(() => readRecentCommits({ owner: "example", repo: "product" }, "bad..ref"));
});
