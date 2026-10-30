import Link from "next/link";
import { Suspense } from "react";
import { ExternalLink, GitBranch, ChevronLeft, ChevronRight } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { COMMIT_PAGE_SIZE } from "../change-pagination";
import { recentChanges, type selectedRepository } from "../repository-overview";
import { BranchPicker } from "./branch-picker";

export async function CommitTable({ repository, page, loadRunStatuses }: { repository: ReturnType<typeof selectedRepository>; page: number; loadRunStatuses?: (heads: string[]) => Promise<{ id: string; head: string; status: string }[]> }) {
  const result = await recentChanges(repository, COMMIT_PAGE_SIZE, page).catch(() => null);
  const href = (number: number) => `/changes?${new URLSearchParams({ repository: repository.name, ...(repository.branch ? { branch: repository.branch } : {}), page: String(number) })}`;
  if (!result) return <div role="alert" className="rounded-xl border bg-card p-6"><p className="font-medium">Could not load commit history</p><p className="mt-2 text-sm text-muted-foreground">Check GitHub access and the selected branch, then try again.</p><Link href={href(page)} className={`${buttonVariants({ variant: "outline" })} mt-4`}>Retry</Link></div>;
  const latest = loadRunStatuses ? await loadRunStatuses(result.commits.map(commit => commit.sha)).catch(() => null) : null;
  const query = new URLSearchParams({ repository: repository.name, branch: result.branch });
  const date = (value: string) => new Date(value).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
  const first = (page - 1) * COMMIT_PAGE_SIZE + 1;
  return <section aria-label="Commit history" className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4">
      <div className="flex min-w-0 flex-wrap items-center gap-3"><h2 className="break-all font-semibold">{repository.name}</h2><Badge variant="secondary" className="max-w-full whitespace-normal break-all"><GitBranch className="size-3" aria-hidden="true" />{result.branch}</Badge></div>
      <nav aria-label="Commit pagination" className="flex items-center gap-3">
        {page > 1 ? <Link href={href(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}><ChevronLeft aria-hidden="true" />Previous</Link> : <Button variant="outline" size="sm" disabled><ChevronLeft aria-hidden="true" />Previous</Button>}
        <span className="text-xs text-muted-foreground" aria-current="page">Page {page}</span>
        {result.hasNext && page < 10000 ? <Link href={href(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>Next<ChevronRight aria-hidden="true" /></Link> : <Button variant="outline" size="sm" disabled>Next<ChevronRight aria-hidden="true" /></Button>}
      </nav>
    </div>
    <div className="border-b px-5 py-3"><Suspense fallback={<p className="text-xs text-muted-foreground">Loading branches…</p>}><BranchPicker repository={repository} selected={result.branch} /></Suspense></div>
    <Table className="table-fixed">
      <caption className="sr-only">Recent commits, newest first. Analyze a change to start a DocSyde run.</caption>
      <TableHeader className="bg-muted/50"><TableRow><TableHead scope="col" className="w-[70%] px-5 text-xs text-muted-foreground sm:w-[37%]">Commit</TableHead><TableHead scope="col" className="hidden w-[18%] text-xs text-muted-foreground sm:table-cell">Author</TableHead><TableHead scope="col" className="hidden w-[16%] text-xs text-muted-foreground sm:table-cell">Committed (UTC)</TableHead><TableHead scope="col" className="px-4 text-xs text-muted-foreground sm:w-[10%]">SHA</TableHead><TableHead scope="col" className="hidden w-[19%] text-xs text-muted-foreground sm:table-cell">DocSyde</TableHead></TableRow></TableHeader>
      <TableBody>{result.commits.map(commit => {
        const detail = `/changes/${commit.sha}?${query}`;
        const run = latest?.find(candidate => candidate.head === commit.sha);
        const actions = <div className="flex flex-col items-start gap-2"><Link href={detail} className={buttonVariants({ variant: "outline", size: "sm" })}>Analyze change</Link>{run ? <Link href={`/runs/${run.id}?${query}`} className="text-xs text-primary underline">{run.status.replaceAll("-", " ")}</Link> : <span className="text-xs text-muted-foreground">{latest ? "Not analyzed" : "Run status unavailable"}</span>}</div>;
        return <TableRow key={commit.sha}>
          <TableCell className="px-5 py-4 whitespace-normal"><Link href={detail} className="break-words font-medium leading-6 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring">{commit.message}</Link><a href={commit.url} target="_blank" rel="noreferrer" aria-label={`View ${commit.sha.slice(0, 7)} on GitHub (opens new tab)`} className="ml-2 inline-block text-muted-foreground hover:text-primary"><ExternalLink className="size-3" /></a><p className="mt-1 break-words text-xs leading-5 text-muted-foreground sm:hidden">{commit.author}{commit.date && <> · <time dateTime={commit.date}>{date(commit.date)}</time></>}</p><div className="mt-3 sm:hidden">{actions}</div></TableCell>
          <TableCell className="hidden break-words whitespace-normal text-muted-foreground sm:table-cell">{commit.author}</TableCell><TableCell className="hidden whitespace-normal text-xs text-muted-foreground sm:table-cell">{commit.date ? <time dateTime={commit.date}>{date(commit.date)}</time> : "Unavailable"}</TableCell><TableCell className="px-4 font-mono text-xs text-muted-foreground"><span title={commit.sha}>{commit.sha.slice(0, 7)}</span></TableCell><TableCell className="hidden whitespace-normal sm:table-cell">{actions}</TableCell>
        </TableRow>;
      })}{!result.commits.length && <TableRow><TableCell colSpan={5} className="px-5 py-14 text-center whitespace-normal"><p className="font-medium">{page === 1 ? "No commits yet" : "No commits on this page"}</p><p className="mt-2 text-sm text-muted-foreground">{page === 1 ? "Commits on this branch will appear here." : "Return to a previous page to view earlier results."}</p></TableCell></TableRow>}</TableBody>
    </Table>
    <footer className="border-t px-5 py-4"><p className="text-xs text-muted-foreground">{result.commits.length ? `Showing ${first}–${first + result.commits.length - 1} commits` : "0 commits on this page"}</p></footer>
  </section>;
}
