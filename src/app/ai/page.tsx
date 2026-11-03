import Link from "next/link";
import { Suspense } from "react";
import { AppShell } from "@/components/application/shell";
import { LoadingList } from "@/components/application/loading-list";
import { selectedRepository, type RepositorySearch } from "@/features/sources/repository/repository-overview";
async function AIContent({ searchParams }: { searchParams: Promise<RepositorySearch> }) {
  let repository;
  try { repository = selectedRepository(await searchParams); } catch { return <main className="p-8" role="alert">Invalid repository selection.</main>; }
  return <AppShell repository={repository.name} branch={repository.branch} active="AI">
    <header className="max-w-2xl space-y-3">
      <h1 className="text-3xl font-semibold tracking-tight">In-app documentation</h1>
      <p className="leading-7 text-muted-foreground">Give your tools documentation that stays connected to your product.</p>
    </header>
    <div className="max-w-3xl divide-y rounded-xl border bg-card px-6">
      <section className="space-y-4 py-6">
        <h2 className="text-lg font-semibold">Use published documentation in your app</h2>
        <p className="text-sm leading-7 text-muted-foreground">The DocSyde SDK retrieves published documentation for a repository and an exact page pathname. Your app chooses how to display it. Pending changes stay private to the review flow.</p>
        <p className="text-sm">Read-only endpoint</p>
        <code className="block overflow-x-auto rounded-md bg-muted p-3 text-xs">GET /api/documentation/context?owner=OWNER&amp;repo=REPO&amp;route=/your-page</code>
        <p className="text-sm leading-7 text-muted-foreground">Use the SDK’s retrieveDocumentation helper with the endpoint URL, repository, and host context. The current integration supports exact page matching.</p>
      </section>
      <section className="space-y-3 py-6">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Connect an AI tool with MCP</h2>
        </div>
        <p className="text-sm leading-7 text-muted-foreground">AI agents can read the same current published documentation through the local, read-only MCP interface. Pending changes stay separate.</p>
        <Link href={`/mcp?${new URLSearchParams({ repository: repository.name })}`} className="text-sm text-primary underline">Connect AI agents →</Link>
      </section>
    </div>
    <Link href={`/docs?${new URLSearchParams({ repository: repository.name, tab: "live" })}`} className="text-sm underline underline-offset-4">Browse published documentation</Link>
  </AppShell>;
}
export default function AIPage(props: { searchParams: Promise<RepositorySearch> }) {
  return <Suspense fallback={<LoadingList />}>
    <AIContent {...props} />
  </Suspense>;
}
