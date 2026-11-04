import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createGithubClient } from "./client";
import { demoRepository } from "./demo-repository";
import { SourceReadError } from "./errors";
import { branchSelectionQuery } from "./branch-query";
import { readBranches, readCommitDetails, readRecentCommits, readRepositoryMetadata } from "./browse";
import { compareCommits, readFileAtCommit, resolveRevision } from "./source-reader";
import { readRepositoryTree } from "./repository-tree";
import { readRecentBranchSelection } from "./recent-branch";
import { assertAllowedRepository } from "@/features/sources/repository-access";
import { configuredRepositories, selectedRepository } from "@/features/sources/repository/repository-overview";

const secret = "fixture-token-never-print";
function configure(t: TestContext, repositories = "Example/Product") {
  const values = { GITHUB_TOKEN: secret, DOCSYDE_ANALYSIS_REPOSITORIES: repositories };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}
function sourceError(code: SourceReadError["code"]) {
  return (error: unknown) => error instanceof SourceReadError && error.code === code && !error.message.includes(secret);
}
const metadata = { full_name: "example/product", default_branch: "main" };

test("DocSyde requires one valid configured target before contacting GitHub", async t => {
  configure(t);
  t.mock.method(globalThis, "fetch", () => { throw new Error("No request expected"); });
  for (const configured of ["", " , ", "example/product,example/other", "bad", "example/product/extra", "example/.."] ) {
    process.env.DOCSYDE_ANALYSIS_REPOSITORIES = configured;
    assert.throws(() => configuredRepositories(), sourceError("invalid-input"));
    await assert.rejects(createGithubClient, sourceError("invalid-input"));
  }
  delete process.env.DOCSYDE_ANALYSIS_REPOSITORIES;
  assert.throws(demoRepository, sourceError("invalid-input"));
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = " Example/Product, example/product ";
  assert.deepEqual(configuredRepositories(), ["example/product"]);
  assert.equal(selectedRepository({}).name, "example/product");
  assert.throws(() => selectedRepository({ repository: "example/other" }), sourceError("forbidden"));
  assert.throws(() => assertAllowedRepository("example", "other"), sourceError("forbidden"));
});

test("client validates target access without enumerating token grants", async t => {
  configure(t);
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    paths.push(url.pathname);
    assert.ok(new Headers(init?.headers).get("authorization")?.includes(secret));
    assert.equal(url.pathname.toLowerCase(), "/repos/example/product");
    return Response.json(metadata);
  });
  const client = await createGithubClient();
  assert.deepEqual(paths, ["/repos/example/product"]);
  await client.rest.repos.get({ owner: "EXAMPLE", repo: "PRODUCT" });
  assert.equal(paths.length, 2);
  await assert.rejects(() => client.rest.repos.get({ owner: "example", repo: "other" }), sourceError("forbidden"));
  await assert.rejects(() => client.request("GET https://example.com/repos/example/product"), sourceError("forbidden"));
  await assert.rejects(() => client.request("GET /user/repos"), sourceError("forbidden"));
  assert.equal(paths.length, 2, "denied requests never reach the network");
});

test("all GitHub entry points reject other repositories, including CLI-style direct client calls", async t => {
  configure(t);
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    paths.push(url.pathname);
    assert.equal(url.pathname.toLowerCase(), "/repos/example/product");
    return Response.json(metadata);
  });
  const other = { owner: "example", repo: "other" }, sha = "a".repeat(40);
  const operations = [
    () => readRepositoryMetadata(other.owner, other.repo),
    () => readBranches(other), () => readRecentCommits(other), () => readCommitDetails(other, sha),
    () => resolveRevision({ ...other, revision: "main" }),
    () => compareCommits({ ...other, base: "main", head: "next" }),
    () => readFileAtCommit({ ...other, commitSha: sha, path: "README.md" }),
    () => readRepositoryTree(other, sha), () => readRecentBranchSelection(other.owner, other.repo),
  ];
  for (const operation of operations) await assert.rejects(operation, sourceError("forbidden"));
  const client = await createGithubClient();
  await assert.rejects(() => client.rest.git.getRef({ ...other, ref: "heads/main" }), sourceError("forbidden"));
  assert.ok(paths.length > 0);
});

test("GraphQL permits only the existing target-bound branch query", async t => {
  configure(t);
  let queries = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname === "/repos/example/product") return Response.json(metadata);
    assert.equal(url.pathname, "/graphql"); queries++;
    return Response.json({ data: { repository: { defaultBranchRef: { name: "main" }, refs: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } });
  });
  assert.deepEqual((await readRecentBranchSelection("example", "product")).names, []);
  const client = await createGithubClient();
  await assert.rejects(() => client.graphql(branchSelectionQuery, { owner: "example", repo: "other", after: null }), sourceError("forbidden"));
  await assert.rejects(() => client.graphql('query { other: repository(owner:"example", name:"other") { id } }'), sourceError("forbidden"));
  assert.equal(queries, 1);
});

test("access failures are sanitized and cannot return an unvalidated client", async t => {
  configure(t);
  let status = 401, failedNetwork = false, malformed = false;
  t.mock.method(globalThis, "fetch", async () => {
    if (failedNetwork) throw new Error(secret);
    return Response.json(malformed ? {} : { message: secret }, { status });
  });
  for (const [value, code] of [[401, "unauthorized"], [403, "forbidden"], [404, "not-found"], [429, "rate-limited"], [500, "upstream"]] as const) {
    status = value;
    await assert.rejects(createGithubClient, sourceError(code));
  }
  status = 200; malformed = true;
  await assert.rejects(createGithubClient, sourceError("upstream"));
  failedNetwork = true;
  await assert.rejects(createGithubClient, sourceError("upstream"));
  delete process.env.GITHUB_TOKEN;
  await assert.rejects(createGithubClient, sourceError("missing-credentials"));
});

test("the repository boundary applies without a flag and cannot be disabled", async t => {
  configure(t);
  const previous = process.env.DOCSYDE_DEMO_SINGLE_REPO_ONLY;
  t.after(() => { if (previous === undefined) delete process.env.DOCSYDE_DEMO_SINGLE_REPO_ONLY; else process.env.DOCSYDE_DEMO_SINGLE_REPO_ONLY = previous; });
  for (const value of [undefined, "false", "true", "1"]) {
    if (value === undefined) delete process.env.DOCSYDE_DEMO_SINGLE_REPO_ONLY;
    else process.env.DOCSYDE_DEMO_SINGLE_REPO_ONLY = value;
    assert.deepEqual(demoRepository(), { owner: "example", repo: "product" });
    assert.throws(() => assertAllowedRepository("example", "other"), sourceError("forbidden"));
    process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "example/product,example/other";
    await assert.rejects(createGithubClient, sourceError("invalid-input"));
    process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "example/product";
  }
});
