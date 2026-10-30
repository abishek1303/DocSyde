import Link from "next/link";
import { Suspense } from "react";
import { selectedRepository, type RepositorySearch } from "@/features/sources/repository-overview";
import { readSelectedChange } from "@/features/sources/selected-change";
import { ChangeRunForm } from "@/features/documentation/components/change-run-form";
import { LoadingList } from "@/components/application/loading-list";
import { Badge } from "@/components/ui/badge";
async function ChangeContent({ params, searchParams }: { params: Promise<{ commit: string }>; searchParams: Promise<RepositorySearch> }) {
  const search = await searchParams;
  let repository;
  try { repository = selectedRepository(search); } catch { return <main className="p-8" role="alert">Invalid repository selection.</main>; }
  const commit = await readSelectedChange(repository, (await params).commit).catch(() => null);
  const back = `/changes?${new URLSearchParams({ repository: repository.name, ...(repository.branch ? { branch: repository.branch } : {}) })}`;
  return <main className="mx-auto w-full max-w-5xl space-y-6 px-5 py-8 sm:px-8"><Link href={back} className="text-sm text-muted-foreground underline">← Repository changes</Link>{!commit ? <p role="alert">Could not load this commit. Check GitHub access and the selected repository, then reload.</p> : <>
    <header className="space-y-4"><div className="flex flex-wrap gap-2"><Badge variant="secondary">{repository.name}</Badge>{repository.branch && <Badge variant="outline">{repository.branch}</Badge>}</div><h1 className="break-words text-2xl font-semibold tracking-tight">{commit.message.split("\n")[0]}</h1><p className="text-sm text-muted-foreground">{commit.author}{commit.date && <> · <time dateTime={commit.date}>{new Date(commit.date).toLocaleString("en-US", { timeZone: "UTC" })} UTC</time></>}</p><p className="break-all font-mono text-xs text-muted-foreground">{commit.sha}</p><a href={commit.url} target="_blank" rel="noreferrer" className="text-sm underline">View on GitHub ↗<span className="sr-only"> (opens new tab)</span></a></header>
    <div className="rounded-xl border bg-card p-5"><h2 className="font-semibold">What will be analyzed?</h2><p className="mt-2 break-all font-mono text-xs leading-6 text-muted-foreground">{commit.base ?? "No parent"} → {commit.sha}</p>{commit.merge && <p className="mt-2 text-sm text-muted-foreground">Merge commit: the default compares its first parent with the merge result.</p>}<p className="mt-2 text-sm text-muted-foreground">The comparison uses committed source evidence. This does not change your checkout.</p><details className="mt-4"><summary className="cursor-pointer text-sm font-medium">Changed files{commit.filesMayBeLimited ? " (first page only)" : ` (${commit.files.length})`}</summary><ul className="mt-3 divide-y">{commit.files.map(file => <li key={file.path} className="py-3"><p className="break-all text-sm">{file.path} <span className="text-xs text-muted-foreground">· {file.status} · +{file.additions} −{file.deletions}</span></p>{file.patch && <details className="mt-2"><summary className="cursor-pointer text-xs text-muted-foreground">Inspect supplied patch</summary><pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-3 text-xs">{file.patch}</pre></details>}</li>)}</ul></details></div>
    <ChangeRunForm owner={repository.owner} repo={repository.repo} head={commit.sha} base={commit.base} branch={repository.branch} />
  </>}</main>;
}
export default function ChangePage(props: { params: Promise<{ commit: string }>; searchParams: Promise<RepositorySearch> }) { return <Suspense fallback={<LoadingList />}><ChangeContent {...props} /></Suspense>; }
