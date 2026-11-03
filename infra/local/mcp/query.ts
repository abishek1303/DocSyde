import "dotenv/config";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
async function main() {
  const [tool = "get_product_context", repository, route] = process.argv.slice(2);
  const args = process.argv.slice(2), urlIndex = args.indexOf("--url");
  const url = urlIndex >= 0 ? args[urlIndex + 1] : process.env.DOCSYDE_MCP_URL || "http://127.0.0.1:3000/api/mcp";
  if (!repository) { console.error("Usage: npm run mcp:query -- get_product_context OWNER/REPO [--url http://127.0.0.1:3000/api/mcp]\nOr: get_documentation OWNER/REPO /product/route [--url URL]"); process.exitCode = 1; }
  else {
    const client = new Client({ name: "docsyde-demo-agent", version: "1.0.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(url)));
      const result = await client.callTool({ name: tool, arguments: { repository, ...(tool === "get_product_context" ? {} : { route }) } });
      console.log(JSON.stringify(result.structuredContent ?? result.content, null, 2));
      if (result.isError) process.exitCode = 1;
    } catch { console.error("DocSyde MCP is unavailable. Start the local app with MCP enabled and check its URL."); process.exitCode = 1; }
    finally { await client.close(); }
  }

}
void main();
