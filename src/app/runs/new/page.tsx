import { RepositorySetupAlert } from "@/features/sources/components/repository-setup-alert";
import { SourceReadError } from "@/integrations/github/errors";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { FreshFullScanForm } from "@/features/documentation/components/runs/fresh-full-scan-form";
import { getPendingWorkspace, hasActionablePendingChanges } from "@/features/documentation/review/pending-workspace";
import { PENDING_REVIEW_MESSAGE } from "@/features/documentation/review/run-eligibility";
import { ArrowRight, GitCompareArrows, ScanSearch } from "lucide-react";
import { hasExistingDocumentation } from "@/features/documentation/library/library-operations";
import { Suspense } from "react";
import { LoadingList } from "@/components/application/loading-list";
import { BranchRunForm } from "@/features/documentation/components/runs/branch-run-form";
import { RetryRunForm } from "@/features/documentation/components/runs/retry-run-form";
import { prepareDocumentationRun } from "@/features/documentation/runs/prepare-run";
import { selectedRepository, defaultBranch, runBranchSelection, type RepositorySearch } from "@/features/sources/repository/repository-overview";

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
    return <main className="flex min-h-full items-center justify-center p-6 sm:p-12">
      <RepositorySetupAlert title={error instanceof SourceReadError && error.code === "invalid-input" ? "Only one repository is supported for this demo." : "Check your repository selection"} message={error instanceof SourceReadError && error.code === "invalid-input" ? "Please update your configuration to include only the repository you want DocSyde to analyze." : error instanceof SourceReadError ? error.message : "Invalid repository or branch selection. Select your configured repository and try again."} />
    </main>;
  }
  try { await defaultBranch(repository); }
  catch (error) {
    return <main className="flex min-h-full items-center justify-center p-6 sm:p-12"><RepositorySetupAlert title="Unable to access your GitHub repository" message={`${error instanceof SourceReadError ? error.message : "GitHub access could not be validated. Check GITHUB_TOKEN and try again."} For this demo, configure your GitHub token to access only the repository you want DocSyde to analyze.`} /></main>;
  }
  const pendingReview = await hasActionablePendingChanges(repository.name).catch(() => null);
  const pendingBatch = pendingReview === true ? await getPendingWorkspace({ repository: repository.name }).catch(() => null) : null;
  const available = !search.rerun ? await hasExistingDocumentation(repository).catch(() => null) : null;
  const latest = !search.rerun && search.mode === "changes" && available === true;
  const fullScan = !search.rerun && search.mode === "full";
  const branches = pendingReview === false && (latest || fullScan) ? await runBranchSelection(repository).catch(() => null) : null;
  const query = new URLSearchParams({ repository: repository.name, ...(repository.branch ? { branch: repository.branch } : {}) });
  if (pendingReview === false && (latest || fullScan)) {
    return <main id="main-content" className="mx-auto w-full max-w-3xl space-y-7 px-5 py-9 sm:px-8 sm:py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{fullScan ? "Generate documentation" : "Latest Changes"}</h1>
      <BranchRunForm fullScan={fullScan} key={repository.name} repository={repository.name} branches={branches?.names ?? []} latestChanges={branches?.changes ?? []} selected={branches?.selected ?? repository.branch} selectionUnavailable={!branches} />
    </main>;
  }
  const unavailableReason = available === null ? "We couldn’t check this project’s documentation. Please try again." : "No documentation is available to update yet.";
  return <main id="main-content" className="mx-auto w-full max-w-5xl space-y-7 px-5 py-9 sm:px-8 sm:py-12">
    <h1 className="text-3xl font-semibold tracking-tight">{search.rerun ? "Rerun" : "Start a new run"}</h1>
    {pendingReview !== false ? <section className="max-w-2xl space-y-5">
      <p role="status" className="text-sm leading-7">{pendingReview ? PENDING_REVIEW_MESSAGE : "Run availability could not be checked. Reload after checking the database connection."}</p>
      <Link href={`/docs?${new URLSearchParams({ repository: repository.name, tab: "pending" })}`} className={buttonVariants()}>Review pending changes</Link>
      <div className="grid gap-4 sm:grid-cols-2">{["Full Scan", "Latest Changes"].map(mode => <div key={mode} role="group" aria-label={mode} aria-disabled="true" className="rounded-xl border bg-muted/25 p-5 text-sm text-muted-foreground">{mode}</div>)}</div>
      {pendingBatch && pendingBatch.count > 0 && <FreshFullScanForm key={`${repository.name}:${pendingBatch.hash}`} repository={repository.name} branch={repository.branch} expectedHash={pendingBatch.hash} />}
    </section> : search.rerun ? <Suspense fallback={<LoadingList />}><RerunSetup search={search} /></Suspense> : <>
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

  </main>;
}
export default function NewRunPage(props: { searchParams: Promise<SetupSearch> }) {
  return <Suspense fallback={<LoadingList />}>
    <Setup {...props} />
  </Suspense>;
}
