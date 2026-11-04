import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createRequire } from "node:module";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { draftFixture } from "../../../../infra/local/documentation/draft-fixture";
import { knowledgeResultSchema } from "./knowledge-contract";
const load = createRequire(join(process.cwd(), "package.json"));
function setup(t: TestContext) {
  const old = { DOCSYDE_ANALYSIS_REPOSITORIES: process.env.DOCSYDE_ANALYSIS_REPOSITORIES, DOCSYDE_MCP_ENABLED: process.env.DOCSYDE_MCP_ENABLED };
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "example/product"; process.env.DOCSYDE_MCP_ENABLED = "1";
  const document = draftFixture(); document.provenance.repository = "https://github.com/example/product";
  const state = { document, available: true, failed: false, more: false, laterPage: false };
  const modules = ["src/features/documentation/library/library-operations.ts", "src/features/sources/product-knowledge.ts"].map(path => { const resolved = load.resolve(`./${path}`); load(resolved); return load.cache[resolved]!; });
  const exportsBefore = modules.map(module => module.exports);
  modules[0].exports = { ...exportsBefore[0], documentationHub: async (scope: { owner: string; repo: string; page?: number }, tab: string) => {
    assert.equal(scope.owner, "example"); assert.equal(scope.repo, "product"); assert.equal(tab, "live");
    if (state.failed) throw new Error("PRIVATE_DATABASE_ERROR");
    return { kind: "live", entries: state.available && (!state.laterPage || scope.page === 2) ? [{ document: state.document, route: "/issues/detail", publishedAt: "2026-11-01T00:00:00.000Z" }] : [], hasMore: state.laterPage ? scope.page === 1 : state.more };
  }, currentPublishedDocumentation: async (scope: { owner: string; repo: string }, route: string) => {
    assert.equal(scope.owner, "example"); assert.equal(scope.repo, "product");
    return state.available && route === "/issues/detail" ? { document: state.document, route, publishedAt: "2026-11-01T00:00:00.000Z" } : null;
  } };
  modules[1].exports = { getUnderstanding: async (repository: string) => { assert.equal(repository, "example/product"); return ({ sha: "a".repeat(40), analyzedAt: "2026-10-30T00:00:00.000Z", summary: { purpose: "Team issue tracking", audience: "Teams", terminology: ["Issue"], gaps: ["Snapshot may be stale"], workflows: ["PRIVATE_ADVISORY_WORKFLOW"] }, generationContext: { productContextUsed: "PRIVATE_HUMAN_NOTE" } }); } };
  const paths = ["src/features/documentation/knowledge/product-knowledge.ts", "src/features/documentation/knowledge/mcp-server.ts", "src/app/api/mcp/route.ts"].map(path => load.resolve(`./${path}`)), cached = paths.map(path => load.cache[path]);
  paths.forEach(path => { delete load.cache[path]; });
  const query = load(paths[0]) as typeof import("./product-knowledge"), server = load(paths[1]) as typeof import("./mcp-server");
  const route = load(paths[2]) as typeof import("@/app/api/mcp/route");
  t.after(() => { modules.forEach((module, i) => { module.exports = exportsBefore[i]; }); paths.forEach((path, i) => { if (cached[i]) load.cache[path] = cached[i]; else delete load.cache[path]; }); for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const inference = t.mock.method(globalThis, "fetch", () => { throw new Error("No model calls allowed"); });
  return { state, inference, ...query, ...server, handleMcpRequest: route.POST };
}
test("current docs and bounded advisory orientation stay separate; no pending or raw context is queried", async t => {
  const s = setup(t), result = await s.queryProductKnowledge("get_product_context", { repository: "example/product" });
  assert.equal(result.status, "available"); assert.equal(result.documents[0].documentId, s.state.document.id);
  assert.equal(result.authority, "current-live-publications"); assert.equal(result.orientation?.authority, "advisory-repository-understanding");
  assert.ok(!JSON.stringify(result).includes("PRIVATE_")); assert.equal(s.inference.mock.callCount(), 0);
  s.state.more = true; assert.equal((await s.queryProductKnowledge("get_product_context", { repository: "example/product" })).moreDocuments, true);
});
test("exact routes resolve and empty results remain distinct from empty projects", async t => {
  const s = setup(t);
  const result = await s.queryProductKnowledge("get_context_for_surface", { repository: "example/product", route: "/issues/detail" });
  assert.equal(result.documents[0].route, "/issues/detail");
  assert.equal((await s.queryProductKnowledge("get_documentation", { repository: "example/product", route: "/unknown" })).status, "not-found");
  assert.equal((await s.queryProductKnowledge("get_product_context", { repository: "other/project" })).status, "not-found");
  assert.equal((await s.queryProductKnowledge("approve", { repository: "example/product" })).status, "invalid-request");
  assert.equal((await s.queryProductKnowledge("get_documentation", { repository: "example/product", route: "//evil.test" })).status, "invalid-request");
  s.state.available = false; assert.equal((await s.queryProductKnowledge("get_product_context", { repository: "example/product" })).status, "no-live-documentation");
  s.state.failed = true; const failed = await s.queryProductKnowledge("get_product_context", { repository: "example/product" });
  assert.equal(failed.status, "unavailable"); assert.ok(!JSON.stringify(failed).includes("PRIVATE_DATABASE_ERROR"));
  assert.equal(s.inference.mock.callCount(), 0);
});
test("MCP local transport rejects disabled access, foreign hosts and cross-origin requests", async t => {
  const s = setup(t), request = (headers: Record<string, string>) => new Request("http://127.0.0.1/api/mcp", { method: "POST", headers });
  process.env.DOCSYDE_MCP_ENABLED = "0"; assert.equal((await s.handleMcpRequest(request({ host: "127.0.0.1" }))).status, 503);
  process.env.DOCSYDE_MCP_ENABLED = "1";
  assert.equal((await s.handleMcpRequest(request({ host: "evil.test" }))).status, 403);
  assert.equal((await s.handleMcpRequest(request({ host: "localhost", origin: "https://evil.test" }))).status, 403);
  assert.equal(s.inference.mock.callCount(), 0);
});
test("official MCP client negotiates HTTP, lists only read-only tools, and retrieves real query output", async t => {
  const s = setup(t), client = new Client({ name: "offline-agent", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1/api/mcp"), { fetch: async (input, init) => {
    const request = new Request(input, init); request.headers.set("host", "127.0.0.1");
    return s.handleMcpRequest(request);
  } });
  t.after(() => client.close()); await client.connect(transport);
  const tools = await client.listTools(); assert.deepEqual(tools.tools.map(tool => tool.name), ["get_product_context", "get_documentation", "get_context_for_surface"]);
  assert.ok(tools.tools.every(tool => !tool.inputSchema.required?.includes("repository") && !tool.inputSchema.required?.includes("route")));
  assert.ok(tools.tools.every(tool => tool.annotations?.readOnlyHint && tool.annotations.destructiveHint === false));
  const response = await client.callTool({ name: "get_documentation", arguments: { repository: "example/product", route: "/issues/detail" } });
  assert.equal(response.isError, false); const data = knowledgeResultSchema.parse(response.structuredContent);
  assert.equal(data.documents[0].documentId, s.state.document.id); assert.equal(data.orientation, null);
  const overview = await client.callTool({ name: "get_product_context", arguments: { query: "What does this application do?" } });
  assert.equal(overview.isError, false);
  assert.equal(knowledgeResultSchema.parse(overview.structuredContent).orientation?.purpose, "Team issue tracking");
  const search = await client.callTool({ name: "get_documentation", arguments: { query: "field requirement" } });
  assert.equal(search.isError, false);
  assert.equal(knowledgeResultSchema.parse(search.structuredContent).documents[0].documentId, s.state.document.id);
  assert.equal(s.inference.mock.callCount(), 0);
});

test("single configured project answers generic questions and searches published guides", async t => {
  const s = setup(t);
  s.state.document.title = "Issue management: submit a request";
  s.state.document.sections[0].title = "Change issue priority";
  for (const input of [{}, { query: "What does this application do?" }, { query: "How do I submit a request?" }, { query: "How do I change an issue's priority?" }, { repository: "issue management" }, { repository: "other/project", query: "issue priority" }]) {
    const result = await s.queryProductKnowledge("get_product_context", input);
    assert.equal(result.status, "available", JSON.stringify(input));
    assert.equal(result.repository, "example/product");
    assert.equal(result.documents[0].documentId, s.state.document.id);
    assert.equal(result.orientation?.purpose, "Team issue tracking");
  }
  const guide = await s.queryProductKnowledge("get_documentation", { query: "submit request" });
  assert.equal(guide.status, "available"); assert.equal(guide.orientation, null);
  s.state.laterPage = true;
  assert.equal((await s.queryProductKnowledge("get_documentation", { query: "issue priority" })).status, "available");
  s.state.laterPage = false;
  const missing = await s.queryProductKnowledge("get_product_context", { query: "astronomy" });
  assert.equal(missing.status, "not-found"); assert.match(missing.message, /No matching published/);
  assert.equal(missing.orientation?.purpose, "Team issue tracking");
  s.state.available = false;
  for (const input of [{ query: "issue priority" }, { route: "/missing" }]) {
    assert.equal((await s.queryProductKnowledge("get_documentation", input)).status, "no-live-documentation");
  }
  assert.equal(s.inference.mock.callCount(), 0);
});

test("short questions find a meaningful term in published body text without matching question filler", async t => {
  const s = setup(t);
  s.state.document.sections[0].content[0].markdown = "Set the priority using the dropdown.";
  for (const name of ["get_product_context", "get_documentation", "get_context_for_surface"]) {
    const result = await s.queryProductKnowledge(name, { query: "Could you please explain priority?" });
    assert.equal(result.status, "available");
    assert.equal(result.documents[0].documentId, s.state.document.id);
    assert.equal((await s.queryProductKnowledge(name, { query: "Could you please explain astronomy?" })).status, "not-found");
  }
});

test("single-project resolution cannot be overridden and missing configuration fails cleanly", async t => {
  const s = setup(t);
  for (const name of ["get_product_context", "get_documentation", "get_context_for_surface"]) {
    const result = await s.queryProductKnowledge(name, { repository: "other/project", query: "field requirement" });
    assert.equal(result.status, "available"); assert.equal(result.repository, "example/product");
  }
  delete process.env.DOCSYDE_ANALYSIS_REPOSITORIES;
  assert.equal((await s.queryProductKnowledge("get_product_context", {})).status, "unavailable");
  assert.equal(s.inference.mock.callCount(), 0);
});

test("published search does not depend on historical association findings", async t => {
  const s = setup(t);
  const association = s.state.document.context.find(context => context.origin === "finding");
  assert.ok(association && association.origin === "finding");
  association.findingRef = "historical-finding-no-longer-present";
  const result = await s.queryProductKnowledge("get_documentation", { query: "field requirement" });
  assert.equal(result.status, "available");
  assert.equal(result.documents[0].documentId, s.state.document.id);
});

test("large published guides return explicitly bounded excerpts instead of unavailable", async t => {
  const s = setup(t);
  const section = s.state.document.sections[0];
  section.content[0].markdown = "x".repeat(1501);
  section.content.push(structuredClone(section.content[0]));
  const { randomUUID } = await import("node:crypto");
  while (s.state.document.sections.length < 6) s.state.document.sections.push({ ...structuredClone(section), id: randomUUID() });
  const result = await s.queryProductKnowledge("get_product_context", {});
  assert.equal(result.status, "available");
  assert.equal(result.documents[0].sections.length, 4);
  assert.equal(result.documents[0].sections[0].blocks.length, 2);
  assert.equal(result.documents[0].sections[0].blocks[0].length, 1500);
  assert.match(result.documents[0].limitations[0], /truncated/);
  assert.equal(s.state.document.sections.length, 6);
  knowledgeResultSchema.parse(result);
});

test("query excerpts include a matching sixth section and late block within existing limits", async t => {
  const s = setup(t), document = s.state.document;
  const template = document.sections[0];
  document.sections = Array.from({ length: 6 }, (_, index) => ({ ...structuredClone(template),
    id: crypto.randomUUID(), title: `Guide section ${index + 1}`,
    content: [{ markdown: `General introduction ${index + 1}.`, factRefs: [] }],
  }));
  document.sections[5].title = "Find and Bulk-Triage Issues";
  document.sections[5].content = [
    { markdown: "General introduction.", factRefs: [] }, { markdown: "Navigation details.", factRefs: [] },
    { markdown: "Bulk triage lets you select 1–100 issues and apply status or priority atomically.", factRefs: [] },
  ];
  const before = JSON.stringify(document);
  for (const tool of ["get_product_context", "get_documentation", "get_context_for_surface"]) {
    const result = await s.queryProductKnowledge(tool, { query: "How does bulk triage work?", ...(tool === "get_product_context" ? {} : { route: "/issues/detail" }) });
    const excerpt = result.documents[0];
    assert.equal(excerpt.sections[0].title, "Find and Bulk-Triage Issues");
    assert.match(excerpt.sections[0].blocks[0], /1–100 issues/);
    assert.equal(excerpt.sections.length, 4); assert.equal(excerpt.sections[0].blocks.length, 2);
    assert.ok(excerpt.limitations.some(note => note.includes("truncated")));
    assert.ok(knowledgeResultSchema.safeParse(result).success);
    assert.deepEqual(await s.queryProductKnowledge(tool, { query: "How does bulk triage work?", ...(tool === "get_product_context" ? {} : { route: "/issues/detail" }) }), result);
  }
  for (const input of [{}, { route: "/issues/detail" }]) {
    const overview = await s.queryProductKnowledge("get_documentation", input);
    assert.deepEqual(overview.documents[0].sections.map(section => section.title), document.sections.slice(0, 4).map(section => section.title));
  }
  assert.equal(JSON.stringify(document), before); assert.equal(s.inference.mock.callCount(), 0);
});
