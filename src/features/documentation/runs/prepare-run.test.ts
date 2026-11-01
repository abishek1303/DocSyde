import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { stopRunCoordinator } from "./run-coordinator";
import { closeDatabase } from "@/integrations/database/client";
import { createBranchDocumentationRun, prepareDocumentationRun } from "./prepare-run";

test("branch changes pin the preview to that branch without database writes or inference", async t => {
  const previous = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, DATABASE_URL: process.env.DATABASE_URL, DOCSYDE_ANALYSIS_REPOSITORIES: process.env.DOCSYDE_ANALYSIS_REPOSITORIES };
  process.env.GITHUB_TOKEN = "fixture";
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "example/product";
  delete process.env.DATABASE_URL;
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const base = "a".repeat(40), main = "b".repeat(40), featureBase = "c".repeat(40), feature = "d".repeat(40);
  const commit = (sha: string) => ({ sha, html_url: `https://github.com/example/product/commit/${sha}`, parents: [{ sha: sha === feature ? featureBase : base }], commit: { message: `Change ${sha.slice(0, 1)}`, author: { name: "Test" }, committer: { date: "2026-10-31T12:00:00Z" } } });
  let branchReads = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, "https://api.github.com", "Preview must not call model providers");
    if (url.pathname === "/graphql") {
      branchReads++;
      return Response.json({ data: { repository: { defaultBranchRef: { name: "main" }, refs: { nodes: [
        { name: "main", target: { messageHeadline: "feat: Improve request creation", committedDate: "2026-10-30T12:00:00Z" } },
        { name: "feature/docs", target: { messageHeadline: "feat: Improve request creation", committedDate: "2026-10-31T12:00:00Z" } },
      ], pageInfo: { hasNextPage: false, endCursor: null } } } } });
    }
    if (url.pathname === "/repos/example/product") return Response.json({ default_branch: "main" });
    if (url.pathname.endsWith("/commits")) return Response.json([commit(url.searchParams.get("sha") === "feature/docs" ? feature : main)]);
    if (url.pathname.includes("/compare/")) {
      const isFeature = url.pathname.endsWith(feature);
      return Response.json({ status: "ahead", merge_base_commit: { sha: isFeature ? featureBase : base }, total_commits: 1, commits: [commit(isFeature ? feature : main)], files: [{ filename: "page.tsx", status: "modified", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-old\n+new" }] });
    }
    return Response.json(commit(url.pathname.split("/").at(-1)!));
  });
  const initial = await prepareDocumentationRun({ repository: "example/product" });
  assert.equal(initial.repository.branch, "feature/docs");
  assert.equal(initial.preview?.head, feature);
  assert.equal(branchReads, 1);
  const manual = await prepareDocumentationRun({ repository: "example/product", branch: "main" });
  assert.equal(manual.preview?.head, main);
  assert.equal(branchReads, 1, "Explicit branch selection must override automatic selection");
  const switched = await prepareDocumentationRun({ repository: "example/product", branch: "feature/docs" });
  assert.equal(switched.repository.branch, "feature/docs");
  assert.equal(switched.preview?.head, feature);
  assert.equal(switched.preview?.base, featureBase);
  assert.equal(switched.canStart, true);
});


test("simple run submission validates context and rejects client-supplied comparison controls before provider access", async t => {
  const calls = t.mock.fn(() => { throw new Error("Invalid submissions must not access providers"); });
  t.mock.method(globalThis, "fetch", calls);
  await assert.rejects(() => createBranchDocumentationRun({ repository: "example/product", branch: "main", runContext: "x".repeat(301) }));
  await assert.rejects(() => createBranchDocumentationRun({ repository: "example/product", branch: "main", runContext: null, base: "client-selected-base", head: "client-selected-head" }));
  assert.equal(calls.mock.callCount(), 0);
});


test("simple submission pins the selected branch and saves context in a pending run without starting inference", async t => {
  const previous = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, DATABASE_URL: process.env.DATABASE_URL, DOCSYDE_ANALYSIS_REPOSITORIES: process.env.DOCSYDE_ANALYSIS_REPOSITORIES };
  process.env.GITHUB_TOKEN = "fixture";
  process.env.DATABASE_URL = "postgres://fixture:fixture@localhost/fixture";
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "example/product";
  t.after(async () => { await stopRunCoordinator(); await closeDatabase(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const base = "a".repeat(40), head = "b".repeat(40);
  const commit = (sha: string) => ({ sha, html_url: `https://github.com/example/product/commit/${sha}`, parents: [{ sha: base }], commit: { message: "Improve request creation", author: { name: "Test" }, committer: { date: "2026-10-31T12:00:00Z" } } });
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, "https://api.github.com", "Starting setup must not invoke inference");
    if (url.pathname === "/repos/example/product") return Response.json({ default_branch: "main" });
    if (url.pathname.endsWith("/commits")) { assert.equal(url.searchParams.get("sha"), "feature/requests"); return Response.json([commit(head)]); }
    if (url.pathname.includes("/compare/")) return Response.json({ status: "ahead", merge_base_commit: { sha: base }, total_commits: 1, commits: [commit(head)], files: [{ filename: "form.ts", status: "modified", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-old\n+new" }] });
    return Response.json(commit(url.pathname.split("/").at(-1)!));
  });
  let inserted: unknown;
  t.mock.method(Pool.prototype, "query", async (query: { text: string }, params: unknown[]) => {
    if (query.text.startsWith("insert")) { assert.equal(params[2], "pending"); inserted = typeof params[3] === "string" ? JSON.parse(params[3]) : params[3]; }
    else assert.ok(query.text.startsWith("select"));
    return { rows: [] };
  });
  const result = await createBranchDocumentationRun({ repository: "example/product", branch: "feature/requests", runContext: "Focus on creating requests." });
  assert.equal(result.status, "created");
  assert.ok(inserted && typeof inserted === "object" && "input" in inserted);
  assert.deepEqual(inserted.input, { owner: "example", repo: "product", branch: "feature/requests", base, head, paths: [], associations: [], runContext: "Focus on creating requests." });
});
