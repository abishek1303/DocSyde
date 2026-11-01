import Link from "next/link";
import { Suspense } from "react";
import { AppShell } from "@/components/application/shell";
import { LoadingList } from "@/components/application/loading-list";
import { selectedRepository, type RepositorySearch } from "@/features/sources/repository/repository-overview";
import { archivedDocumentationDraft, documentationLibrary, latestDocumentationDraft } from "@/features/documentation/library/library-operations";
import { DocumentationTabs, type DocumentationTab } from "@/features/documentation/components/reader/documentation-tabs";
import { DocumentationReader } from "@/features/documentation/components/reader/documentation-reader";
import { DraftInspector } from "@/features/documentation/components/reader/draft-inspector";

type Search = RepositorySearch & { tab?: string; view?: string; version?: string };
const date = (value: string) => new Date(value).toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium" });
async function DocumentView({ scope, tab, search, repository }: { scope: { owner: string; repo: string }; tab: DocumentationTab; search: Search; repository: string }) {
  if (tab === "latest") {
    const result = await latestDocumentationDraft(scope).then(value => ({ value })).catch(() => null);
    if (!result) return <Unavailable />;
    const latest = result.value;
    return latest ? <DocumentationReader key={latest.document.id} title={latest.document.title} sections={latest.document.sections.map(({ id, title }) => ({ id, title }))} view="Latest" backHref={`/docs?${new URLSearchParams({ repository, tab: "latest" })}`}>
      <DraftInspector document={latest.document} savedAt={latest.savedAt} appearance="help" showMetadata={false} />
    </DocumentationReader> : <div className="p-8">
      <Empty title="No draft yet" text="Start a run and save a reviewed update to see your latest draft here." />
    </div>;
  }
  const query = new URLSearchParams({ repository, tab });
  if (tab === "archive" && search.version) {
    const result = await archivedDocumentationDraft(scope, search.version).then(value => ({ value })).catch(() => null);
    if (!result) return <Unavailable />;
    const version = result.value;
    return version ? <DocumentationReader key={search.version} title={version.document.title} sections={version.document.sections.map(({ id, title }) => ({ id, title }))} view="Archive" backHref={`/docs?${query}`}>
      <p className="mb-6 text-xs text-muted-foreground">Published {date(version.publishedAt)} · Archived {date(version.archivedAt)} · {version.route}</p>
      <DraftInspector document={version.document} published appearance="help" showMetadata={false} />
    </DocumentationReader> : <div className="p-8">
      <Link href={`/docs?${query}`} className="mb-6 block text-sm underline">← Archive</Link>
      <Empty title="Version not found" text="This archived version is unavailable for this repository." />
    </div>;
  }
  const page = Number(search.page ?? 1);
  const library = await documentationLibrary({ ...scope, page }, tab).catch(() => null);
  if (!library) return <Unavailable />;
  return <>
    <h1 className="text-3xl font-semibold tracking-tight">{tab === "pending" ? "Pending changes" : "Archive"}</h1>
    {tab === "pending" ? library.proposals.length ? <ul className="divide-y rounded-xl border bg-card px-6">{library.proposals.map(entry => <li key={entry.id} className="space-y-2 py-5">
      <Link href={`/documentation/proposals/${entry.id}?${new URLSearchParams({ repository })}`} className="font-medium hover:text-primary">{entry.title}</Link>
      <p className="text-sm text-muted-foreground">Awaiting approval · {date(entry.date)}</p>
    </li>)}</ul> : <Empty title="You're all caught up" text="No changes are waiting for approval." /> : library.archive.length ? <ul className="divide-y rounded-xl border bg-card px-6">{library.archive.map(entry => <li key={entry.id} className="space-y-2 py-5">
      <Link href={`/docs?${query}&version=${entry.id}`} className="font-medium hover:text-primary">{entry.title}</Link>
      <p className="text-sm text-muted-foreground">Published {date(entry.date)} · {entry.route}</p>
    </li>)}</ul> : <Empty title="No archived versions yet" text="Previous published versions appear here when they are replaced or unpublished." />}
    <nav aria-label="Documentation pagination" className="flex gap-5 text-sm underline">{page > 1 && <Link href={`/docs?${query}&page=${page - 1}`}>Newer items</Link>}{library.hasMore && <Link href={`/docs?${query}&page=${page + 1}`}>Older items</Link>}</nav>
  </>;
}
function Unavailable() {
  return <p role="alert" className="m-6 rounded-lg border bg-card p-6">Documentation is unavailable. Check the repository selection, PostgreSQL and migrations, then reload.</p>;
}

function Empty({ title, text }: { title: string; text: string }) {
  return <section className="space-y-2 rounded-xl border bg-card p-8">
    <h2 className="font-semibold">{title}</h2>
    <p className="text-sm leading-7 text-muted-foreground">{text}</p>
  </section>;
}
async function DocsContent({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  let repository;
  try { repository = selectedRepository(search); } catch { return <main className="p-8" role="alert">Invalid repository selection.</main>; }
  const tab = search.tab === "pending" || search.view === "library" ? "pending" : search.tab === "archive" ? "archive" : "latest";
  return <AppShell contentLayout={tab === "latest" || (tab === "archive" && Boolean(search.version)) ? "workspace" : "page"} repository={repository.name} showBranch={false} active="Documentation" headerContent={<DocumentationTabs repository={repository.name} selected={tab} />}>
    <DocumentView scope={{ owner: repository.owner, repo: repository.repo }} repository={repository.name} tab={tab} search={search} />
  </AppShell>;
}
export default function DocsPage(props: { searchParams: Promise<Search> }) {
  return <Suspense fallback={<LoadingList />}>
    <DocsContent {...props} />
  </Suspense>;
}
