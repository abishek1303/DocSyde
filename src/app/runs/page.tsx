import { Suspense } from "react";
import { selectedRepository, type RepositorySearch } from "@/features/sources/repository-overview";
import { RunHistory } from "@/features/documentation/components/run-history";
import { LoadingList } from "@/components/application/loading-list";
async function RunsContent({ searchParams }: { searchParams: Promise<RepositorySearch> }) {
  const search = await searchParams;
  let repository;
  try { repository = selectedRepository(search); } catch { return <main className="p-8" role="alert">Invalid repository selection.</main>; }
  return <main className="mx-auto w-full max-w-5xl space-y-6 px-5 py-8 sm:px-8"><header className="space-y-2"><h1 className="text-2xl font-semibold">Runs</h1><p className="break-words text-sm text-muted-foreground">{repository.name} · Analysis attempts and documentation proposals</p></header><Suspense fallback={<LoadingList />}><RunHistory owner={repository.owner} repo={repository.repo} before={search.before || search.id ? { createdAt: search.before ?? "", id: search.id ?? "" } : undefined} /></Suspense></main>;
}
export default function RunsPage(props: { searchParams: Promise<RepositorySearch> }) { return <Suspense fallback={<LoadingList />}><RunsContent {...props} /></Suspense>; }
