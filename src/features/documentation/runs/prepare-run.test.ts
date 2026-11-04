import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { draftFixture } from "../../../../infra/local/documentation/draft-fixture";
import { Pool, type QueryConfig } from "pg";
import { stopRunCoordinator } from "./run-coordinator";
import { closeDatabase } from "@/integrations/database/client";
import { createBranchDocumentationRun, prepareDocumentationRun } from "./prepare-run";

function mockTransactions(t: TestContext) {
  t.mock.method(Pool.prototype, "connect", async function(this: Pool) {
    return { query: (query: string | QueryConfig, params?: unknown[]) => /^(begin|commit|rollback)/i.test(typeof query === "string" ? query : query.text) ? Promise.resolve({ rows: [] }) : this.query(query, params), release() {} };
  });
}

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
    if (url.pathname === "/repos/example/product") return Response.json({ full_name: "example/product", default_branch: "main" });
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
    if (url.pathname === "/repos/example/product") return Response.json({ full_name: "example/product", default_branch: "main" });
    if (url.pathname.endsWith("/commits")) { assert.equal(url.searchParams.get("sha"), "feature/requests"); return Response.json([commit(head)]); }
    if (url.pathname.includes("/compare/")) return Response.json({ status: "ahead", merge_base_commit: { sha: base }, total_commits: 1, commits: [commit(head)], files: [{ filename: "form.ts", status: "modified", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-old\n+new" }] });
    return Response.json(commit(url.pathname.split("/").at(-1)!));
  });
  const baseline = draftFixture(); baseline.provenance.repository = "https://github.com/example/product";
  let inserted: unknown;
  mockTransactions(t);
  t.mock.method(Pool.prototype, "query", async (query: { text: string }, params: unknown[]) => {
    if (query.text.includes('"documentation_drafts"')) return { rows: [[baseline.id, baseline, "2026-10-31T12:00:00.000Z"]] };
    if (query.text.startsWith("insert")) { assert.equal(params[2], "pending"); inserted = typeof params[3] === "string" ? JSON.parse(params[3]) : params[3]; }
    else assert.ok(/^select/i.test(query.text));
    return { rows: [] };
  });
  const result = await createBranchDocumentationRun({ repository: "example/product", branch: "feature/requests", runContext: "Focus on creating requests." });
  assert.equal(result.status, "created");
  assert.ok(inserted && typeof inserted === "object" && "input" in inserted);
  assert.deepEqual(inserted.input, { owner: "example", repo: "product", branch: "feature/requests", base, head, paths: [], associations: [], runContext: "Focus on creating requests." });
});


test("Latest Changes is blocked without existing documentation before source reads or run creation", async t => {
  const previous = { DATABASE_URL: process.env.DATABASE_URL, DOCSYDE_ANALYSIS_REPOSITORIES: process.env.DOCSYDE_ANALYSIS_REPOSITORIES };
  process.env.DATABASE_URL = "postgres://fixture:fixture@localhost/fixture";
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "example/empty";
  t.after(async () => { await closeDatabase(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  t.mock.method(globalThis, "fetch", () => { throw new Error("No source or model calls allowed"); });
  mockTransactions(t);
  t.mock.method(Pool.prototype, "query", async (query: { text: string }) => {
    assert.ok(query.text.startsWith("select"), "No run can be inserted");
    return { rows: [] };
  });
  const result = await createBranchDocumentationRun({ repository: "example/empty", branch: "main" });
  assert.equal(result.status, "blocked");
});

test("Full Scan pins a current snapshot without a diff, prior documents, inference or publication writes", async t => {
  const { createFullScanRun } = await import("./prepare-run");
  const previous = { GITHUB_TOKEN: process.env.GITHUB_TOKEN, DATABASE_URL: process.env.DATABASE_URL, DOCSYDE_ANALYSIS_REPOSITORIES: process.env.DOCSYDE_ANALYSIS_REPOSITORIES };
  process.env.GITHUB_TOKEN = "fixture";
  process.env.DATABASE_URL = "postgres://fixture:fixture@localhost/fixture";
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "example/product";
  t.after(async () => { await stopRunCoordinator(); await closeDatabase(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const head = "a".repeat(40);
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.origin, "https://api.github.com");
    if (url.pathname === "/repos/example/product") return Response.json({ full_name: "example/product" });
    assert.match(url.pathname, /\/commits\//, "No comparison, diff or tree needed to create a run");
    return Response.json({ sha: head, html_url: `https://github.com/example/product/commit/${head}`, parents: [], commit: { message: "Initial commit", author: { name: "Test" }, committer: { date: "2026-11-01T00:00:00Z" } } });
  });
  let inserted: unknown;
  mockTransactions(t);
  t.mock.method(Pool.prototype, "query", async (query: { text: string }, params: unknown[]) => {
    assert.ok(!/^(insert|update|delete).*documentation_(drafts|publications|reviews)/i.test(query.text), "Published documents and proposals remain untouched during setup");
    if (query.text.startsWith("insert")) inserted = typeof params[3] === "string" ? JSON.parse(params[3]) : params[3];
    else assert.ok(/^select/i.test(query.text));
    return { rows: [] };
  });
  const result = await createFullScanRun({ repository: "example/product", branch: "main", runContext: "Explain onboarding", route: "/onboarding" });
  assert.ok(result.id);
  assert.ok(inserted && typeof inserted === "object" && "input" in inserted);
  assert.deepEqual(inserted.input, { owner: "example", repo: "product", mode: "current-state", branch: "main", base: head, head, paths: [], associations: [{ id: "scan-route", kind: "route", value: "/onboarding", origin: "operator" }], runContext: "Explain onboarding" });
});
