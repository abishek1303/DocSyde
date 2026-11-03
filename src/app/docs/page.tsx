import Link from "next/link";
import { Suspense } from "react";
import { AppShell } from "@/components/application/shell";
import { Breadcrumbs } from "@/components/application/breadcrumbs";
import { LoadingList } from "@/components/application/loading-list";
import { buttonVariants } from "@/components/ui/button";
import { selectedRepository, type RepositorySearch } from "@/features/sources/repository/repository-overview";
import { documentSourceHead, documentationHub, archivedDocumentationDraft } from "@/features/documentation/library/library-operations";
import { getDocumentationDraft } from "@/features/documentation/documents/operations";
import { DocumentationTabs, type DocumentationTab } from "@/features/documentation/components/reader/documentation-tabs";
import { DraftInspector } from "@/features/documentation/components/reader/draft-inspector";

type Search = RepositorySearch & { tab?: string; view?: string; version?: string; document?: string };
const date = (value: string) => new Date(value).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" });
async function DocsContent({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  let repository;
  try { repository = selectedRepository(search); } catch { return <main className="p-8" role="alert">Invalid repository selection.</main>; }
  const tab: DocumentationTab = search.tab === "pending" || search.view === "library" ? "pending" : search.tab === "history" || search.tab === "archive" ? "history" : "live";
  const query = new URLSearchParams({ repository: repository.name, tab });
  const hub = await documentationHub({ owner: repository.owner, repo: repository.repo, page: search.page ?? 1 }, tab).catch(() => null);
  const selected = search.document ? await getDocumentationDraft(search.document, repository.location).catch(() => null) : null;
  // Preserve old archive links without treating saved versions as published content.
  const archived = search.version ? await archivedDocumentationDraft(repository, search.version).catch(() => null) : null;
  const live = hub?.kind === "live" ? hub.entries.find(entry => entry.document.id === search.document) : null;
  const document = tab === "history" ? selected?.status === "found" ? selected.document : archived?.document : live?.document;
  const savedHref = (id: string) => `/docs?${new URLSearchParams({ repository: repository.name, tab: "history", document: id })}`;
  return <AppShell repository={repository.name} showBranch={false} active="Documentation" headerContent={<DocumentationTabs repository={repository.name} selected={tab} />}>
    <Breadcrumbs items={[{ label: "Documents", ...(document ? { href: `/docs?${query}` } : {}) }, ...(document ? [{ label: document.title }] : [])]} />
    {document ? <div className="mx-auto max-w-4xl space-y-6">
      <Link href={`/docs?${query}`} className="text-sm text-primary underline">← {tab === "live" ? "Live documents" : "Version history"}</Link>
      <p className="text-xs text-muted-foreground">{live ? `Live · Published ${date(live.publishedAt)} · ${live.route}` : `Saved revision ${document.id.slice(0, 8)} · ${selected?.status === "found" ? date(selected.savedAt.toISOString()) : "Historical publication"}`} · Source change {documentSourceHead(document)?.slice(0, 8) ?? "Unknown"}</p>
      <DraftInspector document={document} published={Boolean(live)} showMetadata={false} appearance="help" />
    </div> : <>
      <header className="space-y-3"><h1 className="text-3xl font-semibold tracking-tight">{tab === "live" ? "Live documentation" : tab === "pending" ? "Pending changes" : "Document history"}</h1><p className="max-w-2xl text-sm leading-7 text-muted-foreground">{tab === "live" ? "The published source of truth in your product. Reviewing or saving a change does not publish it." : tab === "pending" ? "Review proposed updates, then choose what to save. Publication remains a separate action." : "Inspect immutable saved versions and the source changes behind them. Saved content may not have been published."}</p></header>
      {!hub ? <p role="alert">Documents are unavailable. Check repository access and PostgreSQL, then reload.</p> : <>
        {hub.kind === "live" && (hub.entries.length ? <ul className="grid gap-4 md:grid-cols-2">{hub.entries.map(entry => <li key={entry.publicationId} className="space-y-3 rounded-xl border bg-card p-6"><span className="text-xs font-medium text-primary">Live · {entry.route}</span><h2 className="font-semibold"><Link href={`/docs?${query}&document=${entry.document.id}`} className="hover:text-primary">{entry.document.title}</Link></h2><p className="text-xs text-muted-foreground">Published {date(entry.publishedAt)}</p><p className="text-sm text-muted-foreground">{entry.document.sections.map(section => section.title).join(" · ")}</p></li>)}</ul> : <Empty title="No live documentation yet" text="Saved documents and pending proposals are kept separate. Nothing appears here until you explicitly publish." />)}
        {hub.kind === "pending" && <>
          {hub.entries.length ? <ul className="space-y-4">{hub.entries.map(entry => <li key={entry.id} className="space-y-3 rounded-xl border bg-card p-6"><div className="flex flex-wrap justify-between gap-3"><span className="text-xs font-medium text-primary">{entry.status}</span><span className="text-xs text-muted-foreground">{date(entry.date)}</span></div>{entry.targets.map((target, i) => <div key={i}><h2 className="font-semibold">{target.document}{target.section ? ` / ${target.section}` : ""}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{target.intent}</p></div>)}{entry.runId && <Link className="block text-xs text-muted-foreground underline" href={`/runs/${entry.runId}?${new URLSearchParams({ repository: repository.name })}`}>From run: {entry.runTitle ?? "View change analysis"}</Link>}<Link href={`/documentation/proposals/${entry.id}?${new URLSearchParams({ repository: repository.name, ...(entry.runId ? { fromRun: entry.runId } : {}) })}`} className={buttonVariants({ size: "sm" })}>Review documentation</Link></li>)}</ul> : <Empty title="No proposals waiting for review" text="Run a change analysis to prepare evidence-supported documentation updates." />}
          {!!hub.saves.length && <section className="space-y-4"><h2 className="text-lg font-semibold">Saved, not published</h2><p className="text-sm text-muted-foreground">These saved snapshots are not live. Inspect their review and publication state before sharing.</p><ul className="divide-y rounded-xl border bg-card px-5">{hub.saves.map(entry => <li className="flex flex-wrap items-center justify-between gap-3 py-4" key={entry.document.id}><div><Link className="font-medium text-primary" href={savedHref(entry.document.id)}>{entry.document.title}</Link><p className="mt-1 text-xs text-muted-foreground">Saved {date(entry.savedAt)} · revision {entry.document.id.slice(0, 8)}</p></div><Link href={`/documentation/drafts/${entry.document.id}?${new URLSearchParams({ repository: repository.location })}`} className="text-sm underline">Manage saved document</Link></li>)}</ul></section>}
        </>}
        {hub.kind === "history" && (hub.entries.length ? <ul className="divide-y rounded-xl border bg-card px-6">{hub.entries.map(entry => <li key={entry.document.id} className="space-y-2 py-5"><Link href={savedHref(entry.document.id)} className="font-medium hover:text-primary">{entry.document.title}</Link><p className="text-xs text-muted-foreground">Revision {entry.document.id.slice(0, 8)} · Saved {date(entry.savedAt)} · Source change {documentSourceHead(entry.document)?.slice(0, 8) ?? "Unknown"}</p><p className="text-sm text-muted-foreground">{entry.document.sections.map(section => section.title).join(" · ")}</p></li>)}</ul> : <Empty title="No saved versions yet" text="Immutable saved documents will appear here after review and saving." />)}
        <nav aria-label="Document pagination" className="flex gap-5 text-sm underline">{Number(search.page ?? 1) > 1 && <Link href={`/docs?${query}&page=${Number(search.page) - 1}`}>Newer items</Link>}{hub.hasMore && <Link href={`/docs?${query}&page=${Number(search.page ?? 1) + 1}`}>Older items</Link>}</nav>
      </>}
    </>}
  </AppShell>;
}
function Empty({ title, text }: { title: string; text: string }) { return <section className="space-y-2 rounded-xl border border-dashed p-8"><h2 className="font-medium">{title}</h2><p className="max-w-xl text-sm leading-7 text-muted-foreground">{text}</p></section>; }
export default function DocsPage(props: { searchParams: Promise<Search> }) { return <Suspense fallback={<LoadingList />}><DocsContent {...props} /></Suspense>; }
