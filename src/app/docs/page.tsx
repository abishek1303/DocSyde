import Link from "next/link";
import { Suspense } from "react";
import { AppShell } from "@/components/application/shell";
import { Breadcrumbs } from "@/components/application/breadcrumbs";
import { ArticleSkeleton } from "@/features/documentation/components/reader/article-skeleton";
import { selectedRepository, type RepositorySearch } from "@/features/sources/repository/repository-overview";
import { documentationHub, archivedDocumentationDraft, currentPublishedDocument } from "@/features/documentation/library/library-operations";
import { DocumentationTabs, type DocumentationTab } from "@/features/documentation/components/reader/documentation-tabs";
import { DocumentationReader } from "@/features/documentation/components/reader/documentation-reader";
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
    return <AppShell repository={repository.name} showBranch={false} active="Documentation" headerContent={tabs}>
      <Breadcrumbs items={[{ label: "Documents", href: rootHref }, { label: "Pending Changes" }]} />
      <header className="mx-auto w-full max-w-4xl space-y-3"><h1 className="text-3xl font-semibold tracking-tight">Pending Changes</h1><p className="text-sm leading-7 text-muted-foreground">All documentation updates, ready to publish together.</p></header>
      {workspace ? <PendingPublishWorkspace key={workspace.hash} initial={workspace} /> : <p role="alert">Pending documentation could not be loaded. Please reload.</p>}
    </AppShell>;
  }
  const href = (params: Record<string, string>) => `/docs?${new URLSearchParams({ repository: repository.name, tab, ...params })}`;
  const hub = await documentationHub({ owner: repository.owner, repo: repository.repo, page: search.page ?? 1 }, tab).catch(() => null);
  const live = hub?.kind === "live" ? (search.document ? hub.entries.find(entry => entry.document.id === search.document) : hub.entries[0]) : null;
  const archived = tab === "history" && search.version ? await archivedDocumentationDraft(repository, search.version).catch(() => null) : null;
  const history = hub?.kind === "history" ? hub.entries : [];
  const previous = archived ?? (!search.version ? history[0] : null);
  const comparison = previous ? await currentPublishedDocument(repository, previous.route).catch(() => null) : null;
  const document = tab === "live" ? live?.document : previous?.document;
  const name = tab === "live" ? "Latest Docs" : "Archive";
  const sidebar = hub && <div className="min-w-0 space-y-6">
    {hub.kind === "live" && hub.entries.length > 0 && <nav aria-label="Documents" className="space-y-2"><h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Documentation</h2>{[...new Map(hub.entries.map(entry => [entry.document.id, entry])).values()].map(entry => <Link key={entry.document.id} href={href({ document: entry.document.id })} aria-current={entry.document.id === document?.id ? "page" : undefined} className="block break-words rounded-lg px-3 py-3 text-sm hover:bg-muted aria-[current=page]:bg-accent aria-[current=page]:text-primary">{entry.document.title}</Link>)}</nav>}
    {hub.kind === "history" && history.length > 0 && <nav aria-label="Archived document versions" className="space-y-6">{[...new Set(history.map(entry => entry.route))].map(route => <div key={route} className="space-y-2"><h2 className="break-words text-sm font-semibold">{history.find(entry => entry.route === route)?.document.title}</h2>{history.filter(entry => entry.route === route).map(entry => <Link key={entry.id} href={href({ version: entry.id })} aria-current={(search.version ?? history[0]?.id) === entry.id ? "page" : undefined} className="block rounded-lg px-3 py-3 text-sm hover:bg-muted aria-[current=page]:bg-accent"><span className="block">{date(entry.publishedAt)}</span><span className="mt-1 block text-xs text-muted-foreground">Replaced {date(entry.archivedAt)}</span></Link>)}</div>)}</nav>}
  </div>;
  const breadcrumb = <Breadcrumbs items={[{ label: "Documents", ...(document ? { href: rootHref } : {}) }, ...(tab === "history" ? [{ label: "Archive", ...(document ? { href: href({}) } : {}) }] : []), ...(document ? [{ label: document.title }] : []), ...(document && tab === "history" ? [{ label: "Previous version" }] : [])]} />;
  const pagination = <nav aria-label="Document pagination" className="mt-8 flex gap-5 text-sm underline">{Number(search.page ?? 1) > 1 && <Link href={href({ page: String(Number(search.page) - 1) })}>Newer items</Link>}{hub?.hasMore && <Link href={href({ page: String(Number(search.page ?? 1) + 1) })}>Older items</Link>}</nav>;
  if (hub && document) return <AppShell repository={repository.name} showBranch={false} active="Documentation" contentLayout="workspace" headerContent={tabs}>
    <DocumentationReader key={`${tab}:${document.id}:${search.version ?? ""}`} title={document.title} sections={document.sections.map(({ id, title }) => ({ id, title }))} backHref={href({})} view={tab === "history" ? "Archive" : "Latest"} navigation={sidebar} breadcrumb={breadcrumb}>
      {search.published === "1" && tab === "live" && <p role="status" className="mb-6 rounded-lg border border-primary/20 bg-accent/30 px-5 py-4 text-sm">Your documentation changes are live. Previous live versions are available in Archive.</p>}
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <p className="text-sm font-medium text-primary">{tab === "live" ? "Current live documentation" : `Archived version · ${previous ? date(previous.publishedAt) : ""}`}</p>
        {tab === "history" && <Link className="text-sm text-primary underline" href={rootHref}>View Latest Docs →</Link>}
        <DraftInspector document={document} published={tab === "live"} showMetadata={false} showContents={false} appearance="help" />
        {tab === "history" && comparison && <details className="rounded-lg border p-5"><summary className="cursor-pointer text-sm font-medium">Compare with current live documentation</summary><div className="mt-8"><p className="mb-5 text-xs font-medium uppercase tracking-wide text-primary">Current live version</p><DraftInspector document={comparison} headingLevel="h2" anchorPrefix="current-section" published showMetadata={false} appearance="help" /></div></details>}
      </div>{pagination}
    </DocumentationReader>
  </AppShell>;
  return <AppShell repository={repository.name} showBranch={false} active="Documentation" headerContent={tabs}>
    {breadcrumb}<h1 className="text-3xl font-semibold tracking-tight">{name}</h1>
    {!hub ? <p role="alert">Documentation could not be loaded. Please reload.</p> : document === undefined && ((tab === "live" && hub.entries.length) || history.length) ? <p role="alert">Choose an available document or version.</p> : <section className="space-y-2 rounded-xl border border-dashed p-8"><h2 className="font-medium">{tab === "live" ? "No live documentation yet" : "No previous versions yet."}</h2><p className="text-sm leading-7 text-muted-foreground">{tab === "live" ? "Approved documentation will appear here once you publish it." : "Previous live versions will appear here after you publish an update."}</p></section>}
    {sidebar}{pagination}
  </AppShell>;
}
export default function DocsPage(props: { searchParams: Promise<Search> }) { return <Suspense fallback={<ArticleSkeleton />}><DocsContent {...props} /></Suspense>; }
