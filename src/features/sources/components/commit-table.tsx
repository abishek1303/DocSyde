import Link from "next/link";
import { ExternalLink, GitBranch, ChevronLeft, ChevronRight } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { COMMIT_PAGE_SIZE } from "../change-pagination";
import { recentChanges, type selectedRepository } from "../repository-overview";

export async function CommitTable({ repository, page }: {
  repository: ReturnType<typeof selectedRepository>; page: number;
}) {
  const result = await recentChanges(repository, COMMIT_PAGE_SIZE, page).catch(() => null);
  const href = (number: number) => `/changes?${new URLSearchParams({ repository: repository.name, ...(repository.branch ? { branch: repository.branch } : {}), page: String(number) })}`;
  if (!result) return <div role="alert" className="rounded-xl border bg-card p-6"><p className="font-medium">Could not load commit history</p><p className="mt-2 text-sm text-muted-foreground">Check GitHub access and the selected branch, then try again.</p><Link href={href(page)} className={`${buttonVariants({ variant: "outline" })} mt-4`}>Retry</Link></div>;
  const date = (value: string) => new Date(value).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
  const first = (page - 1) * COMMIT_PAGE_SIZE + 1;
  return <section aria-label="Commit history" className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4"><div className="flex min-w-0 flex-wrap items-center gap-3"><h2 className="break-all font-semibold">{repository.name}</h2><Badge variant="secondary" className="max-w-full whitespace-normal break-all"><GitBranch className="size-3" aria-hidden="true" />{result.branch}</Badge></div>
      <nav aria-label="Commit pagination" className="flex items-center gap-3">{page > 1 ? <Link href={href(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}><ChevronLeft aria-hidden="true" />Previous</Link> : <Button variant="outline" size="sm" disabled><ChevronLeft aria-hidden="true" />Previous</Button>}<span className="text-xs text-muted-foreground" aria-current="page">Page {page}</span>{result.hasNext && page < 10000 ? <Link href={href(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>Next<ChevronRight aria-hidden="true" /></Link> : <Button variant="outline" size="sm" disabled>Next<ChevronRight aria-hidden="true" /></Button>}</nav>
    </div>
    <Table className="table-fixed"><caption className="sr-only">Recent commits on GitHub, newest first. Commit links open GitHub in a new tab.</caption><TableHeader className="bg-muted/50"><TableRow><TableHead scope="col" className="w-[70%] px-5 text-xs text-muted-foreground sm:w-[46%]">Commit</TableHead><TableHead scope="col" className="hidden w-[23%] text-xs text-muted-foreground sm:table-cell">Author</TableHead><TableHead scope="col" className="hidden w-[18%] text-xs text-muted-foreground sm:table-cell">Committed (UTC)</TableHead><TableHead scope="col" className="px-5 text-xs text-muted-foreground">SHA</TableHead></TableRow></TableHeader>
      <TableBody>{result.commits.map(commit => <TableRow key={commit.sha}><TableCell className="px-5 py-4 whitespace-normal"><a href={commit.url} target="_blank" rel="noreferrer" className="break-words font-medium leading-6 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring">{commit.message}<ExternalLink className="ml-2 inline size-3 text-muted-foreground" aria-hidden="true" /><span className="sr-only"> (opens GitHub in a new tab)</span></a><p className="mt-1 break-words text-xs leading-5 text-muted-foreground sm:hidden">{commit.author}{commit.date && <> · <time dateTime={commit.date}>{date(commit.date)}</time></>}</p></TableCell><TableCell className="hidden break-words whitespace-normal text-muted-foreground sm:table-cell">{commit.author}</TableCell><TableCell className="hidden whitespace-normal text-xs text-muted-foreground sm:table-cell">{commit.date ? <time dateTime={commit.date}>{date(commit.date)}</time> : "Unavailable"}</TableCell><TableCell className="px-5 font-mono text-xs text-muted-foreground"><span title={commit.sha}>{commit.sha.slice(0, 7)}</span></TableCell></TableRow>)}{!result.commits.length && <TableRow><TableCell colSpan={4} className="px-5 py-14 text-center whitespace-normal"><p className="font-medium">{page === 1 ? "No commits yet" : "No commits on this page"}</p><p className="mt-2 text-sm text-muted-foreground">{page === 1 ? "Commits on this branch will appear here." : "Return to a previous page to view earlier results."}</p></TableCell></TableRow>}</TableBody>
    </Table>
    <footer className="flex flex-wrap items-center justify-between gap-4 border-t px-5 py-4"><p className="text-xs text-muted-foreground">{result.commits.length ? `Showing ${first}–${first + result.commits.length - 1} commits` : "0 commits on this page"}</p></footer>
  </section>;
}
