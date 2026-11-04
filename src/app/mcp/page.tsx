import { MotionReveal } from "@/components/application/motion-reveal";
import { Suspense } from "react";
import { headers } from "next/headers";
import { Plug, Layers, BookOpen, PanelsTopLeft } from "lucide-react";
import { AppShell } from "@/components/application/shell";
import { LoadingList } from "@/components/application/loading-list";
import { selectedRepository, type RepositorySearch } from "@/features/sources/repository/repository-overview";
import { mcpConnection, mcpEnabled, localMcpRequest } from "@/features/documentation/knowledge/mcp-config";
import { McpConnection } from "@/features/documentation/components/mcp/mcp-connection";

const capabilities = [
  { title: "Product context", description: "Understand your product and its key features.", icon: Layers, color: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400" },
  { title: "Documentation", description: "Access published documentation by product route.", icon: BookOpen, color: "bg-primary/10 text-primary" },
  { title: "Surface context", description: "Get context for a product page and its workflows.", icon: PanelsTopLeft, color: "bg-primary/10 text-primary" },
];
async function McpContent({ searchParams }: { searchParams: Promise<RepositorySearch> }) {
  let repository;
  try { repository = selectedRepository(await searchParams); }
  catch { return <AppShell repository="Choose a project" active="MCP" showBranch={false}><h1 className="text-3xl font-semibold">Connect AI agents</h1><p role="alert" className="text-sm text-muted-foreground">Configure a project to view its MCP connection.</p></AppShell>; }
  const requestHeaders = await headers();
  const enabled = mcpEnabled() && localMcpRequest(requestHeaders);
  const endpoint = mcpConnection(requestHeaders.get("host"));
  return <AppShell repository={repository.name} active="MCP" showBranch={false} contentLayout="workspace">
    <div className="mx-auto h-full w-full max-w-6xl space-y-5 overflow-y-auto px-5 py-6 sm:px-8">
    <header className="flex flex-wrap items-start justify-between gap-5">
      <div className="flex items-start gap-4"><span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Plug aria-hidden="true" className="size-6" /></span><div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Connect AI agents to DocSyde</h1><p className="text-sm text-muted-foreground">Give agents the same product knowledge as your team.</p></div></div>
      <span role="status" className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium ${enabled ? "border-success/25 bg-success-background text-success" : "bg-muted text-muted-foreground"}`}><span aria-hidden="true" className={`size-2 rounded-full ${enabled ? "bg-success" : "bg-muted-foreground"}`} />MCP server · {enabled ? "Running" : "Offline"}</span>
    </header>
    <MotionReveal stagger className="grid gap-5 md:grid-cols-3">{capabilities.map(({ title, description, icon: Icon, color }) => <section data-motion-item key={title} className="flex items-start gap-5 rounded-xl border bg-card p-5 sm:p-6"><span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${color}`}><Icon className="size-6" aria-hidden="true" /></span><div className="space-y-3 pt-1"><h2 className="text-base font-semibold leading-6">{title}</h2><p className="text-sm leading-6 text-muted-foreground">{description}</p></div></section>)}</MotionReveal>
    <McpConnection endpoint={endpoint} enabled={enabled} />
    </div>
  </AppShell>;
}
export default function McpPage(props: { searchParams: Promise<RepositorySearch> }) { return <Suspense fallback={<LoadingList />}><McpContent {...props} /></Suspense>; }
