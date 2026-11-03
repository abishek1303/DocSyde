import "server-only";
export function mcpEnabled() { return process.env.DOCSYDE_MCP_ENABLED === "1"; }
export function localMcpRequest(headers: Pick<Headers, "get">) {
  const host = headers.get("host");
  if (!host || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host)) return false;
  const origin = headers.get("origin");
  if (!origin) return true;
  try { const url = new URL(origin); return url.host === host && ["http:", "https:"].includes(url.protocol); }
  catch { return false; }
}
export function mcpConnection(host: string | null) {
  if (!host || !localMcpRequest(new Headers({ host }))) return null;
  return `http://${host}/api/mcp`;
}
