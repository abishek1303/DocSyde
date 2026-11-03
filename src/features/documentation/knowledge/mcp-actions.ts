"use server";
import { headers } from "next/headers";
import { queryProductKnowledge } from "./product-knowledge";
import { emptyKnowledge } from "./knowledge-contract";
import { localMcpRequest, mcpEnabled } from "./mcp-config";
export async function tryProductKnowledge(tool: unknown, input: unknown) {
  if (!mcpEnabled() || !localMcpRequest(await headers())) return emptyKnowledge("unavailable", "Local MCP access is offline. Complete the setup below to connect.");
  return queryProductKnowledge(tool, input);
}
