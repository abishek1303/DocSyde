import Link from "next/link";
import { ArrowUpRight, GitBranch, Play, RotateCcw } from "lucide-react";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listDocumentationRuns } from "../../runs/run-operations";
import { IllustratedEmptyState } from "@/components/application/illustrated-empty-state";
import { buttonVariants } from "@/components/ui/button";
import { RunStatus } from "./run-status";

function duration(start: string | null, finish: string | null) {
  if (!start) return "—";
  if (!finish) return "In progress";
  const seconds = Math.max(0, Math.round((Date.parse(finish) - Date.parse(start)) / 1000));
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
export async function RunHistory({ owner, repo, limit = 20, before, branch }: { owner: string; repo: string; limit?: number; branch?: string; before?: { createdAt: string; id: string } }) {
  const page = await listDocumentationRuns({ owner, repo, limit, before }).catch(() => null);
  const query = new URLSearchParams({ repository: `${owner}/${repo}`, ...(branch ? { branch } : {}) });
  if (!page) return <p role="alert" className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">Run history is unavailable. Check PostgreSQL migrations, then reload.</p>;
  if (!page.runs.length) return <IllustratedEmptyState kind="runs" title="No runs yet" action={<Link href={`/runs/new?${query}`} className={buttonVariants({ size: "lg" })}><Play aria-hidden="true" />Start a new run</Link>} />;
  return <div className="space-y-5">
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table className="min-w-[960px]">
        <TableCaption className="sr-only">Past runs for {owner}/{repo}, newest first. Dates are Pacific time.</TableCaption>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">{["Run", "Branch", "Comparison", "Status", "Started", "Duration", "Actions"].map(label => <TableHead key={label} scope="col" className="px-4 py-3 text-xs text-muted-foreground">{label}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>{page.runs.map(run => {
          const runQuery = new URLSearchParams({ repository: `${owner}/${repo}`, ...(run.input.branch ? { branch: run.input.branch } : {}) });
          const active = ["pending", "running"].includes(run.status);
          return <TableRow key={run.id}>
            <TableCell className="max-w-80 whitespace-normal px-4 py-5">
              <Link href={`/runs/${run.id}?${runQuery}`} className="line-clamp-2 break-words font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-ring">{run.title}</Link>
              <p className="mt-1.5 font-mono text-xs text-muted-foreground">{run.id.slice(0, 8)}</p>
            </TableCell>
            <TableCell className="max-w-44 px-4">
              <span className="flex items-center gap-1.5">
                <GitBranch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate" title={run.input.branch ?? "Default branch"}>{run.input.branch ?? "Default branch"}</span>
              </span>
            </TableCell>
            <TableCell className="px-4 font-mono text-xs text-muted-foreground">{run.input.base.slice(0, 7)} → {run.input.head.slice(0, 7)}</TableCell>
            <TableCell className="px-4">
              <RunStatus status={run.status} />
            </TableCell>
            <TableCell className="px-4 text-xs">
              <time dateTime={run.createdAt}>
                <span className="block">{new Date(run.createdAt).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "America/Los_Angeles" })}</span>
                <span className="mt-1 block text-muted-foreground">{new Date(run.createdAt).toLocaleTimeString("en-US", { timeStyle: "short", timeZone: "America/Los_Angeles" })} PT</span>
              </time>
            </TableCell>
            <TableCell className="px-4 text-xs text-muted-foreground">{duration(run.startedAt, run.finishedAt)}</TableCell>
            <TableCell className="px-4">
              <div className="flex items-center gap-3">
                <Link href={`/runs/${run.id}?${runQuery}`} className="inline-flex items-center gap-1 text-xs hover:text-primary hover:underline" aria-label={`Open run: ${run.title}`}>Open<ArrowUpRight className="size-3" aria-hidden="true" />
                </Link>{!active && <Link className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary hover:underline" href={`/runs/new?${runQuery}&rerun=${run.id}`} aria-label={`Rerun: ${run.title}`}>
                  <RotateCcw className="size-3" aria-hidden="true" />Rerun</Link>}</div>
            </TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>
    </div>{page.nextCursor && limit > 3 && <Link className="text-sm underline" href={`/runs?${query}&${new URLSearchParams({ before: page.nextCursor.createdAt, id: page.nextCursor.id })}`}>Older runs →</Link>}</div>;
}
