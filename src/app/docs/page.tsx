import Link from "next/link";
import { redirect } from "next/navigation";
import { listDocumentationDrafts } from "@/features/documentation/operations";
import { buttonVariants } from "@/components/ui/button";
import { RepositoryBranch } from "@/features/sources/components/repository-branch";
import { Suspense } from "react";
import { AppShell } from "@/components/application/shell";
import { LoadingList } from "@/components/application/loading-list";
import { DocumentationList } from "@/features/documentation/components/draft-library";
import { selectedRepository, type RepositorySearch } from "@/features/sources/repository-overview";
async function DocsPageContent({ searchParams }: { searchParams: Promise<RepositorySearch & { view?: string }> }) {
  const search = await searchParams;
  let repository;
  try { repository = selectedRepository(search); } catch { return <main className="p-8" role="alert">Invalid repository selection.</main>; }
  const libraryView = search.view === "library" || Boolean(search.before || search.id);
  const drafts = libraryView ? null : await listDocumentationDrafts({ repository: repository.location }).catch(() => null);
  const first = drafts?.entries.find(entry => entry.status === "available");
  if (first) redirect(`/documentation/drafts/${first.id}?${new URLSearchParams({ repository: repository.location })}`);
  if (!libraryView && drafts && !drafts.entries.length) {
    return <AppShell repository={repository.name} branch={repository.branch} branchContext={<RepositoryBranch repository={repository} />} active="Documentation">
      <header className="space-y-3"><p className="text-sm font-medium text-primary">Documentation</p><h1 className="text-3xl font-semibold tracking-tight">Getting started</h1><p className="max-w-xl leading-7 text-muted-foreground">Your repository’s documentation starts here. There are no saved drafts yet.</p></header>
      <div className="max-w-2xl space-y-5 rounded-xl border bg-card p-6"><h2 className="text-xl font-semibold">Create your first guide</h2><ol className="list-decimal space-y-3 pl-5 text-muted-foreground"><li>Review the recent changes in your repository.</li><li>Use the source tools to analyze a change and preview a documentation draft.</li><li>Review the draft and choose Save draft. Your saved guide will open here.</li></ol><div className="flex flex-wrap gap-3"><Link href={`/changes?${new URLSearchParams({ repository: repository.name, ...(repository.branch ? { branch: repository.branch } : {}) })}`} className={buttonVariants()}>Review recent changes</Link><Link href="/sources" className={buttonVariants({ variant: "outline" })}>Open source tools</Link></div><p className="text-sm text-muted-foreground">Saved documents remain unreviewed drafts until you review them.</p></div>
    </AppShell>;
  }
  return <AppShell repository={repository.name} branch={repository.branch} branchContext={<RepositoryBranch repository={repository} />} active="Documentation"><header className="space-y-3"><h1 className="text-3xl font-semibold tracking-tight">Documentation</h1><p className="text-muted-foreground">Saved drafts for this repository. These documents have not been reviewed or published.</p></header><div className="max-w-3xl rounded-xl border bg-card px-6"><Suspense fallback={<LoadingList />}><DocumentationList repository={repository.location} before={search.before || search.id ? { savedAt: search.before ?? "", id: search.id ?? "" } : undefined} /></Suspense></div></AppShell>;
}

export default function DocsPage(props: { searchParams: Promise<RepositorySearch & { view?: string }> }) { return <Suspense fallback={<LoadingList />}><DocsPageContent {...props} /></Suspense>; }
