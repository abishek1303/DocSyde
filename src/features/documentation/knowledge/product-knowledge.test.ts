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
  const state = { document, available: true, failed: false, more: false };
  const modules = ["src/features/documentation/library/library-operations.ts", "src/features/sources/product-knowledge.ts"].map(path => { const resolved = load.resolve(`./${path}`); load(resolved); return load.cache[resolved]!; });
  const exportsBefore = modules.map(module => module.exports);
  modules[0].exports = { ...exportsBefore[0], documentationHub: async () => {
    if (state.failed) throw new Error("PRIVATE_DATABASE_ERROR");
    return { kind: "live", entries: state.available ? [{ document: state.document, route: "/issues/detail", publishedAt: "2026-11-01T00:00:00.000Z" }] : [], hasMore: state.more };
  }, currentPublishedDocumentation: async (_scope: unknown, route: string) => state.available && route === "/issues/detail" ? { document: state.document, route, publishedAt: "2026-11-01T00:00:00.000Z" } : null };
  modules[1].exports = { getUnderstanding: async () => ({ sha: "a".repeat(40), analyzedAt: "2026-10-30T00:00:00.000Z", summary: { purpose: "Team issue tracking", audience: "Teams", terminology: ["Issue"], gaps: ["Snapshot may be stale"], workflows: ["PRIVATE_ADVISORY_WORKFLOW"] }, generationContext: { productContextUsed: "PRIVATE_HUMAN_NOTE" } }) };
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
test("exact routes resolve, empty projects and unknown scopes fail cleanly without inference", async t => {
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
  assert.ok(tools.tools.every(tool => tool.annotations?.readOnlyHint && tool.annotations.destructiveHint === false));
  const response = await client.callTool({ name: "get_documentation", arguments: { repository: "example/product", route: "/issues/detail" } });
  assert.equal(response.isError, false); const data = knowledgeResultSchema.parse(response.structuredContent);
  assert.equal(data.documents[0].documentId, s.state.document.id); assert.equal(data.orientation, null);
  assert.equal(s.inference.mock.callCount(), 0);
});
