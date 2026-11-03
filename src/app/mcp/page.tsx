import { Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { AppShell } from "@/components/application/shell";
import { Breadcrumbs } from "@/components/application/breadcrumbs";
import { LoadingList } from "@/components/application/loading-list";
import { selectedRepository, configuredRepositories, type RepositorySearch } from "@/features/sources/repository/repository-overview";
import { RepositoryPicker } from "@/features/sources/components/repository-picker";
import { mcpConnection, mcpEnabled, localMcpRequest } from "@/features/documentation/knowledge/mcp-config";
import { knowledgeTools } from "@/features/documentation/knowledge/knowledge-contract";
import { queryProductKnowledge } from "@/features/documentation/knowledge/product-knowledge";
import { McpDemo } from "@/features/documentation/components/mcp/mcp-demo";
import { McpConnection } from "@/features/documentation/components/mcp/mcp-connection";
async function McpContent({ searchParams }: { searchParams: Promise<RepositorySearch> }) {
  let repository;
  let repositories: string[] = [];
  try { repositories = configuredRepositories(); repository = selectedRepository(await searchParams); }
  catch { return <AppShell repository="Choose a project" active="MCP" showBranch={false}><Breadcrumbs items={[{ label: "MCP" }]} /><h1 className="text-3xl font-semibold">Connect AI agents</h1><p className="text-muted-foreground">Choose a configured project to share its approved knowledge.</p>{repositories.length > 0 ? <Link className="text-primary underline" href="/mcp">Choose a project</Link> : <p className="text-sm text-muted-foreground">Add a repository through the local DocSyde project setup, then return here.</p>}</AppShell>; }
  const requestHeaders = await headers(), enabled = mcpEnabled() && localMcpRequest(requestHeaders);
  const endpoint = mcpConnection(requestHeaders.get("host"));
  const context = enabled ? await queryProductKnowledge("get_product_context", { repository: repository.name }) : null;
  return <AppShell repository={repository.name} active="MCP" showBranch={false}>
    <Breadcrumbs items={[{ label: "MCP" }]} />
    <header className="flex flex-wrap items-start justify-between gap-5"><div className="max-w-2xl space-y-3"><p className="text-xs font-semibold uppercase tracking-wider text-primary">Product knowledge for AI agents</p><h1 className="text-3xl font-semibold tracking-tight">Connect AI agents to DocSyde</h1><p className="leading-7 text-muted-foreground">The same synchronized product knowledge for humans and agents. When reviewed documentation is published, the next MCP request reads the update.</p></div><span role="status" className={`rounded-full border px-4 py-2 text-sm ${enabled ? "border-primary/25 bg-accent text-primary" : "bg-muted text-muted-foreground"}`}>MCP server · {enabled ? "Running" : "Offline"}</span></header>
    <RepositoryPicker repositories={repositories} selected={repository.name} destination="/mcp" />
    {!enabled && <section className="space-y-2 rounded-xl border border-dashed p-5"><h2 className="font-semibold">Enable local agent access</h2><p className="max-w-2xl text-sm leading-7 text-muted-foreground">MCP runs with your local DocSyde app. Set DOCSYDE_MCP_ENABLED=1 in .env, restart DocSyde, and open it on localhost. Connection instructions are below.</p></section>}
    <div className="grid gap-4 md:grid-cols-3">{knowledgeTools.map(tool => <section key={tool.name} className="space-y-3 rounded-xl border bg-card p-5"><h2 className="text-lg font-semibold">{tool.title}</h2><p className="text-sm leading-7 text-muted-foreground">{tool.description}</p><details className="text-xs text-muted-foreground"><summary className="cursor-pointer">MCP capability</summary><code className="mt-3 block break-all">{tool.name}</code></details></section>)}</div>
    <section className="grid gap-5 rounded-xl border bg-card p-5 sm:grid-cols-2 sm:p-7"><div className="space-y-2"><h2 className="font-semibold text-primary">Approved knowledge</h2><p className="text-sm leading-7 text-muted-foreground">MCP reads current live publications—the same documentation shown in Latest Docs. Each result identifies its document, sections, publication date, and source revision.</p><Link href={`/docs?${new URLSearchParams({ repository: repository.name })}`} className="text-sm text-primary underline">Read Latest Docs →</Link></div><div className="space-y-2"><h2 className="font-semibold">Pending changes stay separate</h2><p className="text-sm leading-7 text-muted-foreground">Proposals and unpublished saves are not authoritative agent context. Repository orientation is labeled advisory and may lag published documentation.</p><Link href={`/docs?${new URLSearchParams({ repository: repository.name, tab: "pending" })}`} className="text-sm text-primary underline">Review pending changes →</Link></div></section>
    {context?.status === "no-live-documentation" && <p role="status" className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No approved documentation is live yet. Review and publish documentation to make it available to agents.</p>}
    {context?.status === "unavailable" && <p role="alert" className="text-sm">Current knowledge could not be loaded. Your local server is available; check the normal DocSyde data setup and reload.</p>}
    <McpDemo key={repository.name} repository={repository.name} enabled={enabled} initialRoute={context?.documents[0]?.route ?? ""} />
    <McpConnection endpoint={endpoint} repository={repository.name} />
  </AppShell>;
}
export default function McpPage(props: { searchParams: Promise<RepositorySearch> }) { return <Suspense fallback={<LoadingList />}><McpContent {...props} /></Suspense>; }
