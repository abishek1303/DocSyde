import Link from "next/link";
import { Suspense } from "react";
import { selectedRepository, type RepositorySearch } from "@/features/sources/repository/repository-overview";
import { RunHistory } from "@/features/documentation/components/runs/run-history";
import { LoadingList } from "@/components/application/loading-list";
import { AppShell } from "@/components/application/shell";
import { buttonVariants } from "@/components/ui/button";
async function RunsContent({ searchParams }: { searchParams: Promise<RepositorySearch> }) {
  const search = await searchParams;
  let repository;
  try { repository = selectedRepository({ repository: search.repository }); } catch { return <main className="p-8" role="alert">Invalid repository selection.</main>; }
  const query = new URLSearchParams({ repository: repository.name });
  return <AppShell repository={repository.name} showBranch={false} active="Runs">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your runs</h1>
      </div>
      <Link href={`/runs/new?${new URLSearchParams({ repository: repository.name })}`} className={buttonVariants()}>Start a new run</Link>
    </header>
    <Suspense fallback={<LoadingList />}>
      <RunHistory owner={repository.owner} repo={repository.repo} before={search.before || search.id ? { createdAt: search.before ?? "", id: search.id ?? "" } : undefined} />
    </Suspense>
    <Link href={`/changes?${query}`} className="text-sm text-muted-foreground underline underline-offset-4">Browse individual commits</Link>
  </AppShell>;
}
export default function RunsPage(props: { searchParams: Promise<RepositorySearch> }) {
  return <Suspense fallback={<LoadingList />}>
    <RunsContent {...props} />
  </Suspense>;
}
