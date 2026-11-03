import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { createProductKnowledgeServer } from "@/features/documentation/knowledge/mcp-server";
import { localMcpRequest, mcpEnabled } from "@/features/documentation/knowledge/mcp-config";

async function handleMcpRequest(request: Request) {
  if (!mcpEnabled()) return Response.json({ error: "MCP is offline. Enable local agent access in DocSyde setup." }, { status: 503 });
  if (!localMcpRequest(request.headers)) return Response.json({ error: "MCP is available to local clients only." }, { status: 403 });
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  // One server per stateless request; HTTP and transport lifecycle stay at this boundary.
  const server = createProductKnowledgeServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch { return Response.json({ error: "The MCP request could not be completed." }, { status: 503 }); }
  finally { await server.close(); }
}
export const POST = handleMcpRequest;
export const GET = handleMcpRequest;
export const DELETE = handleMcpRequest;
