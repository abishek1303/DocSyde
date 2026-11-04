import { demoSingleRepoOnly } from "@/integrations/github/demo-repository";
import { SourceReadError } from "@/integrations/github/errors";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { FreshFullScanForm } from "@/features/documentation/components/runs/fresh-full-scan-form";
import { getPendingWorkspace, hasActionablePendingChanges } from "@/features/documentation/review/pending-workspace";
import { PENDING_REVIEW_MESSAGE } from "@/features/documentation/review/run-eligibility";
import { ArrowRight, GitCompareArrows, ScanSearch } from "lucide-react";
import { hasExistingDocumentation } from "@/features/documentation/library/library-operations";
import { RepositoryPicker } from "@/features/sources/components/repository-picker";
import { Suspense } from "react";
import { AppShell } from "@/components/application/shell";
import { LoadingList } from "@/components/application/loading-list";
import { BranchRunForm } from "@/features/documentation/components/runs/branch-run-form";
import { RetryRunForm } from "@/features/documentation/components/runs/retry-run-form";
import { RunBreadcrumbs } from "@/features/documentation/components/runs/run-breadcrumbs";
import { prepareDocumentationRun } from "@/features/documentation/runs/prepare-run";
import { configuredRepositories, selectedRepository, defaultBranch, runBranchSelection, type RepositorySearch } from "@/features/sources/repository/repository-overview";

type SetupSearch = RepositorySearch & { rerun?: string; mode?: string };
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
  try { repository = selectedRepository(search); } catch (error) {
    return <main className="space-y-5 p-8">
      <RunBreadcrumbs current="Start a run" />
      <p role="alert">{error instanceof SourceReadError ? error.message : "Invalid repository or branch selection."}</p>
    </main>;
  }
  if (demoSingleRepoOnly()) {
    try { await defaultBranch(repository); }
    catch (error) {
      return <AppShell repository={repository.name} active="Runs"><RunBreadcrumbs current="Start a run" /><h1 className="text-2xl font-semibold">Start a new run</h1><p className="text-sm text-muted-foreground">For this demo, configure your GitHub token to access only the repository you want DocSyde to analyze.</p><p role="alert" className="text-sm text-destructive">{error instanceof SourceReadError ? error.message : "GitHub access could not be validated. Check GITHUB_TOKEN and try again."}</p></AppShell>;
    }
  }
  const pendingReview = await hasActionablePendingChanges(repository.name).catch(() => null);
  const pendingBatch = pendingReview === true ? await getPendingWorkspace({ repository: repository.name }).catch(() => null) : null;
  const available = !search.rerun ? await hasExistingDocumentation(repository).catch(() => null) : null;
  const latest = !search.rerun && search.mode === "changes" && available === true;
  const fullScan = !search.rerun && search.mode === "full";
  const branches = pendingReview === false && (latest || fullScan) ? await runBranchSelection(repository).catch(() => null) : null;
  const query = new URLSearchParams({ repository: repository.name, ...(repository.branch ? { branch: repository.branch } : {}) });
  const unavailableReason = available === null ? "We couldn’t check this project’s documentation. Please try again." : "No documentation is available to update yet.";
  return <AppShell repository={repository.name} branchContext={<span>{search.rerun ? "Rerun" : "New run"}</span>} active="Runs">
    <RunBreadcrumbs repository={repository.name} current={search.rerun ? "Rerun" : latest ? "Latest Changes" : fullScan ? "Full Scan" : "New run"} />
    <header className="space-y-3"><h1 className="text-3xl font-semibold tracking-tight">{search.rerun ? "Rerun" : latest ? "Latest Changes" : fullScan ? "Generate documentation" : "Start a new run"}</h1>
      {!search.rerun && <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{latest ? "Compare the latest change on a branch, reuse product understanding, and prepare documentation updates for review." : fullScan ? "Explore a branch and prepare documentation for review." : "Choose how you’d like to update your documentation."}</p>}
    </header>
    {!search.rerun && <RepositoryPicker selected={repository.name} repositories={configuredRepositories()} />}
    {demoSingleRepoOnly() && <p className="max-w-2xl text-xs leading-6 text-muted-foreground">For this demo, configure your GitHub token to access only the repository you want DocSyde to analyze.</p>}
    {pendingReview !== false ? <section className="max-w-2xl space-y-5">
      <p role="status" className="text-sm leading-7">{pendingReview ? PENDING_REVIEW_MESSAGE : "Run availability could not be checked. Reload after checking the database connection."}</p>
      <Link href={`/docs?${new URLSearchParams({ repository: repository.name, tab: "pending" })}`} className={buttonVariants()}>Review pending changes</Link>
      <div className="grid gap-4 sm:grid-cols-2">{["Full Scan", "Latest Changes"].map(mode => <div key={mode} role="group" aria-label={mode} aria-disabled="true" className="rounded-xl border bg-muted/25 p-5 text-sm text-muted-foreground">{mode}</div>)}</div>
      {pendingBatch && pendingBatch.count > 0 && <FreshFullScanForm key={`${repository.name}:${pendingBatch.hash}`} repository={repository.name} branch={repository.branch} expectedHash={pendingBatch.hash} />}
    </section> : search.rerun ? <Suspense fallback={<LoadingList />}><RerunSetup search={search} /></Suspense> : latest || fullScan ? <>
      <Link href={`/runs/new?${query}`} className="text-sm text-primary underline">← Run options</Link>
      <BranchRunForm fullScan={fullScan} key={repository.name} repository={repository.name} branches={branches?.names ?? []} latestChanges={branches?.changes ?? []} selected={branches?.selected ?? repository.branch} selectionUnavailable={!branches} />
    </> : <>
      {search.mode === "changes" && <p role="status" className="text-sm text-muted-foreground">{unavailableReason}</p>}
      <div className="grid max-w-4xl gap-5 md:grid-cols-2">
        <Link href={`/runs/new?${query}&mode=full`} className="group flex min-h-72 flex-col rounded-2xl border bg-card p-6 transition-colors hover:border-primary/50 hover:bg-accent/25 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none">
          <ScanSearch aria-hidden="true" className="mb-6 size-6 text-primary" /><h2 className="text-xl font-semibold">Full scan</h2>
          <p className="mt-3 mb-6 text-sm leading-7 text-muted-foreground">Generate or regenerate documentation from the current repository. Add optional product context, then review proposals before publishing.</p>
          <span className="mt-auto flex items-center gap-2 text-sm font-medium text-primary">Generate documentation <ArrowRight aria-hidden="true" className="size-4" /></span>
        </Link>
        {available ? <Link href={`/runs/new?${query}&mode=changes`} className="group flex min-h-72 flex-col rounded-2xl border bg-card p-6 transition-colors hover:border-primary/50 hover:bg-accent/25 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none">
          <GitCompareArrows aria-hidden="true" className="mb-6 size-6 text-primary" /><h2 className="text-xl font-semibold">Latest Changes</h2>
          <p className="mt-3 mb-6 text-sm leading-7 text-muted-foreground">Analyze the latest code change, inspect the running product when useful, and prepare updates to existing documentation.</p>
          <span className="mt-auto flex items-center gap-2 text-sm font-medium text-primary">Analyze changes <ArrowRight aria-hidden="true" className="size-4" /></span>
        </Link> : <div role="group" aria-labelledby="latest-changes-title" aria-disabled="true" aria-describedby="latest-changes-requirement" className="flex min-h-72 flex-col rounded-2xl border bg-muted/25 p-6 text-muted-foreground">
          <GitCompareArrows aria-hidden="true" className="mb-6 size-6 opacity-50" /><h2 id="latest-changes-title" className="text-xl font-semibold">Latest Changes</h2>
          <p className="mt-3 text-sm leading-7">Prepare updates to existing documentation from the latest code change.</p>
          <div className="mt-auto space-y-2 pt-6"><p id="latest-changes-requirement" className="text-sm leading-6">{unavailableReason}</p>
            {available === false && <><p className="text-xs leading-6">Save documentation for this project to enable Latest Changes.</p><Link aria-disabled={false} href={`/docs?${new URLSearchParams({ repository: repository.name, tab: "pending" })}`} className="inline-block rounded text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">View documentation →</Link></>}
          </div>
        </div>}
      </div>
    </>}

  </AppShell>;
}
export default function NewRunPage(props: { searchParams: Promise<SetupSearch> }) {
  return <Suspense fallback={<LoadingList />}>
    <Setup {...props} />
  </Suspense>;
}
