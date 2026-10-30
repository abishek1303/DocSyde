import { Suspense } from "react";
import { LoadingList } from "@/components/application/loading-list";
import { CommitTable } from "@/features/sources/components/commit-table";
import { parseChangePagination } from "@/features/sources/change-pagination";
import { selectedRepository, type RepositorySearch } from "@/features/sources/repository-overview";
async function ChangesPageContent({ searchParams }: { searchParams: Promise<RepositorySearch> }) {
  const search = await searchParams;
  let repository;
  let pagination;
  try { repository = selectedRepository(search); pagination = parseChangePagination(search); } catch { return <main className="p-8" role="alert">Invalid repository, branch, or page selection.</main>; }
  return <main id="main-content" className="mx-auto w-full max-w-6xl space-y-5 px-5 py-6 sm:px-8"><h1 className="text-2xl font-semibold tracking-tight">Repository changes</h1><Suspense key={`${repository.name}/${repository.branch}/${pagination.page}`} fallback={<LoadingList />}><CommitTable repository={repository} page={pagination.page} /></Suspense></main>;
}

export default function ChangesPage(props: { searchParams: Promise<RepositorySearch> }) { return <Suspense fallback={<LoadingList />}><ChangesPageContent {...props} /></Suspense>; }
