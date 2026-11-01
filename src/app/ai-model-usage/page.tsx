import Link from "next/link";
import { Suspense } from "react";
import { AppShell } from "@/components/application/shell";
import { LoadingList } from "@/components/application/loading-list";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { selectedRepository } from "@/features/sources/repository/repository-overview";
import { listModelUsage } from "@/features/documentation/runs/model-usage-operations";
import { ModelUsageTable, RefreshModelUsage } from "@/features/documentation/components/runs/model-usage-table";

type Search = { repository?: string; runId?: string; stage?: string; status?: string; provider?: string; page?: string };
async function UsageContent({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  let repository;
  try { repository = selectedRepository({ repository: search.repository }); }
  catch { return <p role="alert" className="p-8">Invalid repository selection.</p>; }
  const result = await listModelUsage(search).catch(() => null);
  const query = new URLSearchParams({ repository: repository.name });
  for (const key of ["runId", "stage", "status", "provider"] as const) {
    if (search[key]) query.set(key, search[key]);
  }
  const pageHref = (page: number) => `/ai-model-usage?${new URLSearchParams({ ...Object.fromEntries(query), page: String(page) })}`;
  const filtered = Boolean(search.runId || search.stage || search.status || search.provider);
  const selectClass = "h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring";
  return <AppShell repository={repository.name} showBranch={false} active="Logs">
    <h1 className="text-3xl font-semibold tracking-tight">AI model usage log</h1>
    <form key={query.toString()} action="/ai-model-usage" method="get" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="repository" value={repository.name} />
      {search.runId && <input type="hidden" name="runId" value={search.runId} />}
      <div className="flex flex-col gap-1.5 text-xs font-medium"><label htmlFor="model-usage-status">Status</label>
        <select id="model-usage-status" name="status" defaultValue={search.status ?? ""} className={selectClass}>
          <option value="">All statuses</option><option value="started">Started</option><option value="structured-success">Structured success</option><option value="succeeded">Succeeded</option><option value="failed">Failed</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5 text-xs font-medium"><label htmlFor="model-usage-provider">Provider</label>
        <select id="model-usage-provider" name="provider" defaultValue={search.provider ?? ""} className={selectClass}>
          <option value="">All providers</option><option value="baseten">Baseten</option><option value="meta">Meta</option>
        </select>
      </div>
      <label className="flex flex-col gap-1.5 text-xs font-medium">Stage
        <Input name="stage" defaultValue={search.stage ?? ""} placeholder="All stages" maxLength={100} className="h-9 w-48" />
      </label>
      <Button type="submit" size="sm">Apply filters</Button>
      <RefreshModelUsage />
      {filtered && <Link href={`/ai-model-usage?${new URLSearchParams({ repository: repository.name })}`} className="mb-2 text-sm underline underline-offset-4">Clear filters</Link>}
      {search.runId && <Link href={`/runs/${search.runId}?${new URLSearchParams({ repository: repository.name })}`} className="mb-2 text-xs text-muted-foreground underline underline-offset-4">Run {search.runId.slice(0, 8)}</Link>}
    </form>
    {!result ? <p role="alert" className="rounded-xl border bg-card p-6 text-sm">Invocation logs are unavailable. Check the filters and PostgreSQL migrations, then refresh.</p>
      : <>
        {!result.invocations.length ? <p className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">{filtered || result.page > 1 ? "No invocations match these filters on this page." : "No invocation logs retained."}</p> : <ModelUsageTable invocations={result.invocations} repository={repository.name} />}
        <nav aria-label="Log pagination" className="flex items-center justify-between gap-3">
          {result.page > 1 ? <Link href={pageHref(result.page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>Previous</Link> : <Button variant="outline" size="sm" disabled>Previous</Button>}
          <span className="text-sm text-muted-foreground" aria-current="page">Page {result.page}</span>
          {result.hasNextPage ? <Link href={pageHref(result.page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>Next</Link> : <Button variant="outline" size="sm" disabled>Next</Button>}
        </nav>
      </>}
  </AppShell>;
}
export default function UsagePage(props: { searchParams: Promise<Search> }) {
  return <Suspense fallback={<LoadingList />}><UsageContent {...props} /></Suspense>;
}
