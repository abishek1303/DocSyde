import Link from "next/link";
import { Suspense } from "react";
import { AppShell } from "@/components/application/shell";
import { LoadingList } from "@/components/application/loading-list";
import { BranchRunForm } from "@/features/documentation/components/branch-run-form";
import { RetryRunForm } from "@/features/documentation/components/retry-run-form";
import { RunBreadcrumbs } from "@/features/documentation/components/run-breadcrumbs";
import { prepareDocumentationRun } from "@/features/documentation/prepare-run";
import { selectedRepository, runBranchSelection, type RepositorySearch } from "@/features/sources/repository-overview";

type SetupSearch = RepositorySearch & { rerun?: string };
async function RerunSetup({ search }: { search: SetupSearch }) {
  const run = await prepareDocumentationRun(search).catch(() => null);
  if (!run || !run.rerun) return <p role="alert">This run is unavailable. Return to your runs and try again.</p>;
  const query = new URLSearchParams({ repository: run.repository.name, ...(run.repository.branch ? { branch: run.repository.branch } : {}) });
  return <div className="max-w-2xl space-y-6 rounded-xl border bg-card p-6">
    <div className="space-y-2">
      <p className="text-sm font-medium">Branch</p>
      <p className="text-sm text-muted-foreground">{run.repository.branch ?? "Original branch"}</p>
      <p className="pt-1 text-xs text-muted-foreground">Change being rerun</p>
      <p className="text-sm leading-6">{run.sourceTitle}</p>
    </div>
    <div className="space-y-2">
      <p className="text-sm font-medium">Context</p>
      <p className="whitespace-pre-wrap text-sm text-muted-foreground">{run.runContext || "No additional context."}</p>
    </div>{run.canStart ? <RetryRunForm id={run.rerun} /> : <p role="status" className="text-sm">This run is active. <Link href={`/runs/${run.rerun}?${query}`} className="underline">Return to the run</Link>.</p>}</div>;
}
async function Setup({ searchParams }: { searchParams: Promise<SetupSearch> }) {
  const search = await searchParams;
  let repository;
  try { repository = selectedRepository(search); } catch {
    return <main className="space-y-5 p-8">
      <RunBreadcrumbs current="Start a run" />
      <p role="alert">Invalid repository or branch selection.</p>
    </main>;
  }
  const branches = !search.rerun ? await runBranchSelection(repository).catch(() => null) : null;
  return <AppShell repository={repository.name} branchContext={<span>{search.rerun ? "Rerun" : "New run"}</span>} active="Runs">
    <RunBreadcrumbs repository={repository.name} current={search.rerun ? "Rerun" : "Start a run"} />
    <h1 className="text-3xl font-semibold tracking-tight">{search.rerun ? "Rerun" : "Start a run"}</h1>
    {search.rerun ? <Suspense fallback={<LoadingList />}>
      <RerunSetup search={search} />
    </Suspense> : <BranchRunForm key={repository.name} repository={repository.name} branches={branches?.names ?? []} latestChanges={branches?.changes ?? []} selected={branches?.selected ?? repository.branch} selectionUnavailable={!branches} />}
  </AppShell>;
}
export default function NewRunPage(props: { searchParams: Promise<SetupSearch> }) {
  return <Suspense fallback={<LoadingList />}>
    <Setup {...props} />
  </Suspense>;
}
