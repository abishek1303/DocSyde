"use client";

import { useState } from "react";
import { Check, Copy, Terminal, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function McpConnection({ endpoint, enabled }: { endpoint: string | null; enabled: boolean }) {
  const [address, setAddress] = useState(endpoint ?? "");
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  let valid = false;
  try { valid = ["http:", "https:"].includes(new URL(address).protocol); } catch { /* Show validation beside the editable URL. */ }
  const config = valid ? JSON.stringify({ mcpServers: { docsyde: { type: "http", url: address.trim() } } }, null, 2) : "Enter an HTTP or HTTPS MCP server URL.";
  const local = endpoint ? new URL(endpoint) : null;
  const command = `ngrok http ${local ? local.port || "80" : "3000"} --host-header='${local?.host || "localhost:3000"}'`;
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setCopied(label); setError(""); }
    catch { setError("Couldn’t copy. Select and copy the text manually."); }
  }
  function copyIcon(label: string) { return copied === label ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />; }
  return <section className="space-y-5 rounded-xl border bg-card p-5 sm:p-6">
    <div className="space-y-2"><h2 className="text-xl font-semibold">Connect an AI agent</h2><p className="text-sm text-muted-foreground">Add a Streamable HTTP MCP server in your client.</p></div>
    {!enabled && <p role="status" className="rounded-md border bg-muted/40 px-4 py-3 text-sm">Set <code>DOCSYDE_MCP_ENABLED=1</code> in .env and restart DocSyde on localhost.</p>}
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="space-y-5">
        <div className="space-y-2"><label htmlFor="mcp-server-url" className="text-xs font-medium text-muted-foreground">MCP server URL</label><div className="flex items-center gap-2 rounded-lg border bg-background px-3"><Input id="mcp-server-url" type="url" value={address} maxLength={2048} onChange={event => { setAddress(event.target.value); setCopied(""); }} placeholder="http://localhost:3000/api/mcp" className="min-w-0 border-0 bg-transparent px-0 shadow-none dark:bg-transparent" aria-invalid={Boolean(address && !valid)} /><Button type="button" size="icon" variant="ghost" disabled={!valid} aria-label={copied === "url" ? "MCP URL copied" : "Copy MCP URL"} onClick={() => copy(address.trim(), "url")}>{copyIcon("url")}</Button></div>{address && !valid && <p role="alert" className="text-xs text-destructive">Enter a valid HTTP or HTTPS URL.</p>}</div>
        <div className="space-y-3 rounded-lg border border-primary/25 bg-primary/5 p-4"><h3 className="flex items-center gap-2 text-sm font-medium"><Globe className="size-4 text-primary" aria-hidden="true" />ngrok · External clients</h3><div className="flex items-start gap-2 rounded-md bg-background/70 p-3"><Terminal className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><code className="min-w-0 flex-1 break-all text-xs leading-6">{command}</code><Button type="button" variant="ghost" size="icon" aria-label={copied === "ngrok" ? "ngrok command copied" : "Copy ngrok command"} onClick={() => copy(command, "ngrok")}>{copyIcon("ngrok")}</Button></div><p className="text-xs leading-5 text-muted-foreground">Use your ngrok HTTPS URL with <code>/api/mcp</code> in the field above.</p></div>
      </div>
      <div className="relative min-w-0 overflow-hidden rounded-lg border bg-background/60"><Button type="button" size="icon" variant="ghost" disabled={!valid} className="absolute top-2 right-2" aria-label={copied === "config" ? "Connection config copied" : "Copy connection config"} onClick={() => copy(config, "config")}>{copyIcon("config")}</Button><pre aria-label="MCP connection configuration" className="max-h-80 overflow-auto p-5 pr-12 text-xs leading-6 [scrollbar-width:thin]"><code>{config}</code></pre></div>
    </div>
    <div className="flex flex-wrap items-center gap-4 border-t pt-5"><Button type="button" variant="outline" disabled={!valid} onClick={() => copy(config, "config")}>{copyIcon("config")}{copied === "config" ? "Copied" : "Copy connection config"}</Button>{copied && <span role="status" className="text-xs text-success">{copied === "url" ? "URL" : copied === "ngrok" ? "Command" : "Configuration"} copied</span>}{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</div>
  </section>;
}
