import Link from "next/link";
import { BookOpen, Play } from "lucide-react";
import { IllustratedEmptyState } from "@/components/application/illustrated-empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Suspense } from "react";
import { AppShell } from "@/components/application/shell";
import { Breadcrumbs } from "@/components/application/breadcrumbs";
import { ArticleSkeleton } from "@/features/documentation/components/reader/article-skeleton";
import { selectedRepository, type RepositorySearch } from "@/features/sources/repository/repository-overview";
import { documentationHub, archivedDocumentationSnapshot, documentSourceHead } from "@/features/documentation/library/library-operations";
import { DocumentationTabs, type DocumentationTab } from "@/features/documentation/components/reader/documentation-tabs";
import { DocumentationReader } from "@/features/documentation/components/reader/documentation-reader";
import { PageNavigation } from "@/features/documentation/components/reader/page-navigation";
import { DraftInspector } from "@/features/documentation/components/reader/draft-inspector";
import { getPendingWorkspace } from "@/features/documentation/review/pending-workspace";
import { PendingPublishWorkspace } from "@/features/documentation/components/review/pending-publish-workspace";

type Search = RepositorySearch & { tab?: string; view?: string; version?: string; document?: string; proposal?: string; published?: string };
const date = (value: string) => new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
async function DocsContent({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  let repository;
  try { repository = selectedRepository(search); } catch { return <main className="p-8" role="alert">Choose a valid project to view its documentation.</main>; }
  const tab: DocumentationTab = search.tab === "pending" || search.view === "library" ? "pending" : search.tab === "history" || search.tab === "archive" ? "history" : "live";
  const rootHref = `/docs?${new URLSearchParams({ repository: repository.name })}`;
  const tabs = <DocumentationTabs repository={repository.name} selected={tab} />;
  if (tab === "pending") {
    const workspace = await getPendingWorkspace({ repository: repository.name }).catch(() => null);
    return <AppShell repository={repository.name} showBranch={false} active="Documentation" contentLayout="workspace" headerContent={tabs}>
      <div className="mx-auto flex h-full min-h-0 max-w-screen-2xl flex-col gap-4 px-5 py-5 sm:px-8">
        <Breadcrumbs items={[{ label: "Documents", href: rootHref }, { label: "Pending changes" }]} />
        {workspace ? <PendingPublishWorkspace key={workspace.hash} initial={workspace} focusProposal={search.proposal} /> : <p role="alert">Pending documentation could not be loaded. Please reload.</p>}
      </div>
    </AppShell>;
  }
  const href = (params: Record<string, string>) => `/docs?${new URLSearchParams({ repository: repository.name, tab, ...(search.page ? { page: String(search.page) } : {}), ...params })}`;
  const hub = await documentationHub({ owner: repository.owner, repo: repository.repo, page: search.page ?? 1 }, tab).catch(() => null);

  const snapshot = tab === "history" && search.version ? await archivedDocumentationSnapshot(repository, search.version).catch(() => null) : null;
  const history = hub?.kind === "history" ? hub.entries : [];
  const pages = tab === "live" ? hub?.kind === "live" ? [...new Map(hub.entries.map(entry => [entry.document.id, entry.document])).values()] : [] : snapshot?.documents ?? [];
  const document = search.document ? pages.find(entry => entry.id === search.document) : pages[0];
  const name = tab === "live" ? "Latest docs" : "Archive";
  const sidebar = <PageNavigation entries={pages.map(entry => ({ id: entry.id, title: entry.title, href: href({ document: entry.id, ...(search.version ? { version: search.version } : {}) }) }))} currentId={document?.id} backHref={tab === "history" ? href({}) : undefined} />;
  const breadcrumb = <Breadcrumbs items={[{ label: "Documents", ...(document ? { href: rootHref } : {}) }, ...(tab === "history" ? [{ label: "Archive", ...(document ? { href: href({}) } : {}) }] : []), ...(document ? [{ label: document.title }] : []), ...(document && tab === "history" ? [{ label: "Previous version" }] : [])]} />;
  const pagination = <nav aria-label="Document pagination" className="mt-8 flex gap-5 text-sm underline">{Number(search.page ?? 1) > 1 && <Link href={href({ page: String(Number(search.page) - 1) })}>Newer items</Link>}{hub?.hasMore && <Link href={href({ page: String(Number(search.page ?? 1) + 1) })}>Older items</Link>}</nav>;
  if (hub && document) return <AppShell repository={repository.name} showBranch={false} active="Documentation" contentLayout="workspace" headerContent={tabs}>
    <DocumentationReader key={`${tab}:${document.id}:${search.version ?? ""}`} title={document.title} sections={document.sections.map(({ id, title }) => ({ id, title }))} backHref={href({})} view={tab === "history" ? "Archive" : "Latest"} navigation={sidebar} breadcrumb={breadcrumb}>
      <div className="mx-auto w-full max-w-3xl space-y-6">
        {tab === "history" && snapshot && <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-4 text-xs text-muted-foreground"><span>Version · {date(snapshot.publishedAt)}</span><Link className="text-primary hover:underline" href={rootHref}>Latest docs →</Link></div>}
        <DraftInspector document={document} published={tab === "live"} showMetadata={false} showContents={false} appearance="help" />

      </div>{tab === "live" && pagination}
    </DocumentationReader>
  </AppShell>;
  return <AppShell repository={repository.name} showBranch={false} active="Documentation" headerContent={tabs}>
    {breadcrumb}<h1 className="text-3xl font-semibold tracking-tight">{name}</h1>
    {!hub ? <p role="alert">Documentation could not be loaded. Please reload.</p> : tab === "history" && !search.version && history.length > 0 ? <div className="max-w-3xl space-y-5"><p className="text-sm text-muted-foreground">Select a version to browse the documentation published at that time.</p><nav aria-label="Documentation versions" className="divide-y rounded-xl border bg-card">{[...new Map(history.map(entry => [entry.publishedAt, entry])).values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).map(entry => <Link key={entry.id} href={href({ version: entry.id })} className="flex items-center justify-between gap-4 p-5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><span><span className="block text-sm font-semibold">{date(entry.publishedAt)}</span><span className="mt-1 block text-xs text-muted-foreground">Revision {documentSourceHead(entry.document)?.slice(0, 7) ?? "saved"}</span></span><span className="text-sm text-primary">Browse pages →</span></Link>)}</nav></div> : search.document || search.version ? <p role="alert">This document or version is unavailable. Choose another version.</p> : <IllustratedEmptyState kind={tab === "live" ? "documents" : "archive"} title={tab === "live" ? "No documentation yet" : "No archived docs yet"} action={tab === "live" ? <Link href={`/runs/new?${new URLSearchParams({ repository: repository.name, mode: "full" })}`} className={buttonVariants({ size: "lg" })}><Play aria-hidden="true" />Generate documentation</Link> : <Link href={rootHref} className={buttonVariants({ size: "lg" })}><BookOpen aria-hidden="true" />View latest docs</Link>} />}
    {pagination}
  </AppShell>;
}
export default function DocsPage(props: { searchParams: Promise<Search> }) { return <Suspense fallback={<ArticleSkeleton />}><DocsContent {...props} /></Suspense>; }
