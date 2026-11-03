import Link from "next/link";
import { Suspense } from "react";
import { AppShell } from "@/components/application/shell";
import { Breadcrumbs } from "@/components/application/breadcrumbs";
import { ArticleSkeleton } from "@/features/documentation/components/reader/article-skeleton";
import { selectedRepository, type RepositorySearch } from "@/features/sources/repository/repository-overview";
import { documentationHub, archivedDocumentationDraft, currentPublishedDocument } from "@/features/documentation/library/library-operations";
import { getDocumentationDraft } from "@/features/documentation/documents/operations";
import { getDocumentationReviewPresentation } from "@/features/documentation/review/review-proposal-operations";
import { DocumentationTabs, type DocumentationTab } from "@/features/documentation/components/reader/documentation-tabs";
import { DraftInspector } from "@/features/documentation/components/reader/draft-inspector";
import { ProposalWorkspace } from "@/features/documentation/components/review/proposal-workspace";
import { PublicationControls } from "@/features/documentation/components/publication/publication-controls";

type Search = RepositorySearch & { tab?: string; view?: string; version?: string; document?: string; proposal?: string; published?: string };
const date = (value: string) => new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
async function DocsContent({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  let repository;
  try { repository = selectedRepository(search); } catch { return <main className="p-8" role="alert">Choose a valid project to view its documentation.</main>; }
  const tab: DocumentationTab = search.tab === "pending" || search.view === "library" ? "pending" : search.tab === "history" || search.tab === "archive" ? "history" : "live";
  const href = (params: Record<string, string>) => `/docs?${new URLSearchParams({ repository: repository.name, tab, ...params })}`;
  const hub = await documentationHub({ owner: repository.owner, repo: repository.repo, page: search.page ?? 1 }, tab).catch(() => null);
  const live = hub?.kind === "live" ? (search.document ? hub.entries.find(entry => entry.document.id === search.document) : hub.entries[0]) : null;
  const archived = tab === "history" && search.version ? await archivedDocumentationDraft(repository, search.version).catch(() => null) : null;
  const history = hub?.kind === "history" ? hub.entries : [];
  const previous = archived ?? (!search.version ? history[0] : null);
  const comparison = previous ? await currentPublishedDocument(repository, previous.route).catch(() => null) : null;
  const saved = tab === "pending" && search.document ? await getDocumentationDraft(search.document, repository.location).catch(() => null) : null;
  const proposalId = tab === "pending" && !search.document ? search.proposal ?? (hub?.kind === "pending" ? hub.entries[0]?.id : undefined) : undefined;
  const loadedReview = proposalId ? await getDocumentationReviewPresentation(proposalId).catch(() => null) : null;
  const review = loadedReview?.status === "found" && loadedReview.repository.toLowerCase() === repository.location.toLowerCase() ? loadedReview : null;
  const document = tab === "live" ? live?.document : tab === "history" ? previous?.document : saved?.status === "found" ? saved.document : null;
  const name = tab === "live" ? "Latest Docs" : tab === "pending" ? "Pending Changes" : "Archive";
  const reader = document && <div className="mx-auto w-full max-w-3xl space-y-6">
    <p className="text-sm font-medium text-primary">{tab === "live" ? "Current live documentation" : tab === "history" ? `Archived version · ${previous ? date(previous.publishedAt) : ""}` : "Saved · Not live yet"}</p>
    {tab === "history" && <Link className="text-sm text-primary underline" href={`/docs?${new URLSearchParams({ repository: repository.name })}`}>View Latest Docs →</Link>}
    <DraftInspector document={document} published={tab === "live"} showMetadata={false} appearance="help" />
    {tab === "history" && comparison && <details className="rounded-lg border p-5"><summary className="cursor-pointer text-sm font-medium">Compare with current live documentation</summary><div className="mt-8"><p className="mb-5 text-xs font-medium uppercase tracking-wide text-primary">Current live version</p><DraftInspector document={comparison} headingLevel="h2" anchorPrefix="current-section" published showMetadata={false} appearance="help" /></div></details>}
    {tab === "pending" && <PublicationControls draftId={document.id} repository={document.provenance.repository} />}
  </div>;
  return <AppShell repository={repository.name} showBranch={false} active="Documentation" headerContent={<DocumentationTabs repository={repository.name} selected={tab} />}>
    <Breadcrumbs items={[{ label: "Documents", ...(document || review ? { href: `/docs?${new URLSearchParams({ repository: repository.name })}` } : {}) }, ...(tab !== "live" ? [{ label: name, ...(document || review ? { href: href({}) } : {}) }] : []), ...(document ? [{ label: document.title }] : review ? [{ label: "Review changes" }] : []), ...(document && tab === "history" ? [{ label: "Previous version" }] : [])]} />
    {search.published === "1" && tab === "live" && <p role="status" className="rounded-lg border border-primary/20 bg-accent/30 px-5 py-4 text-sm">Your documentation changes are live. Previous live versions are available in Archive.</p>}
    {!hub ? <p role="alert">Documentation could not be loaded. Please reload.</p> : <>
      {!document && <header className="space-y-3"><h1 className="text-3xl font-semibold tracking-tight">{name}</h1><p className="max-w-2xl text-sm leading-7 text-muted-foreground">{tab === "live" ? "The current documentation for your product." : tab === "pending" ? "See how your documentation will read, choose what to accept, then publish when you’re ready." : "Read previous live versions of your documentation."}</p></header>}
      <div className="grid min-w-0 gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-6">
          {hub.kind === "live" && hub.entries.length > 0 && <nav aria-label="Documents" className="space-y-2"><h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Documentation</h2>{[...new Map(hub.entries.map(entry => [entry.document.id, entry])).values()].map(entry => <Link key={entry.document.id} href={href({ document: entry.document.id })} aria-current={entry.document.id === document?.id ? "page" : undefined} className="block break-words rounded-lg px-3 py-3 text-sm hover:bg-muted aria-[current=page]:bg-accent aria-[current=page]:text-primary">{entry.document.title}</Link>)}</nav>}
          {hub.kind === "pending" && <>
            {hub.entries.length > 0 && <nav aria-label="Pending documentation changes" className="space-y-2"><h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Changes to review</h2>{hub.entries.map(entry => <Link key={entry.id} href={href({ proposal: entry.id })} aria-current={review?.proposalId === entry.id ? "page" : undefined} className="block space-y-2 break-words rounded-lg px-3 py-3 text-sm hover:bg-muted aria-[current=page]:bg-accent"><span className="block font-medium">{[...new Set(entry.targets.map(target => target.document))].join(", ") || "Documentation update"}</span><span className="block text-xs leading-5 text-muted-foreground">{entry.summary}</span><span className="block text-xs text-primary">{entry.status}</span></Link>)}</nav>}
            {hub.saves.length > 0 && <nav aria-label="Saved documentation not live" className="space-y-2"><h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saved, not live</h2>{hub.saves.map(entry => <Link key={entry.document.id} href={href({ document: entry.document.id })} aria-current={document?.id === entry.document.id ? "page" : undefined} className="block space-y-1 break-words rounded-lg px-3 py-3 text-sm hover:bg-muted aria-[current=page]:bg-accent"><span className="block font-medium">{entry.document.title}</span><span className="block text-xs text-muted-foreground">{date(entry.savedAt)}</span></Link>)}</nav>}
          </>}
          {hub.kind === "history" && history.length > 0 && <nav aria-label="Archived document versions" className="space-y-6">{[...new Set(history.map(entry => entry.route))].map(route => <div key={route} className="space-y-2"><h2 className="break-words text-sm font-semibold">{history.find(entry => entry.route === route)?.document.title}</h2>{history.filter(entry => entry.route === route).map(entry => <Link key={entry.id} href={href({ version: entry.id })} aria-current={(search.version ?? history[0]?.id) === entry.id ? "page" : undefined} className="block rounded-lg px-3 py-3 text-sm hover:bg-muted aria-[current=page]:bg-accent"><span className="block">{date(entry.publishedAt)}</span><span className="mt-1 block text-xs text-muted-foreground">Replaced {date(entry.archivedAt)}</span></Link>)}</div>)}</nav>}
        </aside>
        <div className="min-w-0">{reader || (review ? <ProposalWorkspace review={review} /> : hub.kind === "live" ? <Empty title="No live documentation yet" text="Approved documentation will appear here once you publish it." /> : hub.kind === "pending" ? proposalId || search.document ? <p role="alert">This change is unavailable. Choose another change from the list.</p> : <Empty title="No documentation changes waiting for review." text={hub.saves.length ? "Your saved documents are available on the left when you’re ready to publish." : "New documentation updates will appear here after a change analysis."} /> : history.length > 0 ? <p role="alert">Choose an available version from Archive.</p> : <Empty title="No previous versions yet." text="Previous live versions will appear here after you publish an update." />)}</div>
      </div>
      <nav aria-label="Document pagination" className="flex gap-5 text-sm underline">{Number(search.page ?? 1) > 1 && <Link href={href({ page: String(Number(search.page) - 1) })}>Newer items</Link>}{hub.hasMore && <Link href={href({ page: String(Number(search.page ?? 1) + 1) })}>Older items</Link>}</nav>
    </>}
  </AppShell>;
}
function Empty({ title, text }: { title: string; text: string }) { return <section className="space-y-2 rounded-xl border border-dashed p-8"><h2 className="font-medium">{title}</h2><p className="max-w-xl text-sm leading-7 text-muted-foreground">{text}</p></section>; }
export default function DocsPage(props: { searchParams: Promise<Search> }) { return <Suspense fallback={<ArticleSkeleton />}><DocsContent {...props} /></Suspense>; }
