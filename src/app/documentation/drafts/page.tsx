import Link from "next/link";
import { Suspense } from "react";
import { listDocumentationDrafts } from "@/features/documentation/operations";

type Search = Promise<{ before?: string; id?: string }>;

async function SavedDraftList({ searchParams }: { searchParams: Search }) {
  const search = await searchParams;
  let page;
  try {
    page = await listDocumentationDrafts({ before: search.before || search.id ? { savedAt: search.before, id: search.id } : undefined });
  } catch {
    return <p role="alert">Could not load drafts. Check PostgreSQL, migrations, and pagination parameters. <Link href="/documentation/drafts" className="underline">Retry</Link></p>;
  }
  return <div className="space-y-4">
    {!page.entries.length && <p>No saved drafts yet. Generate a draft, preview it, then save it.</p>}
    <ul className="space-y-4">{page.entries.map(entry => <li key={entry.id} className="space-y-1 rounded border p-4">
      <Link href={`/documentation/drafts/${entry.id}`} className="font-semibold underline">{entry.status === "available" ? entry.title : "Unavailable draft"}</Link>

      <p className="text-sm">Saved {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Los_Angeles" }).format(entry.savedAt)}</p>
      {entry.status === "available" ? <><p className="text-sm text-muted-foreground">Unreviewed draft · ready to read</p></> : <p>Stored content failed validation.</p>}
    </li>)}</ul>
    {page.nextCursor && <Link className="underline" href={`/documentation/drafts?${new URLSearchParams({ before: page.nextCursor.savedAt, id: page.nextCursor.id })}`}>Older drafts</Link>}
  </div>;
}

export default function SavedDraftsPage({ searchParams }: { searchParams: Search }) {
  return <Suspense fallback={<p role="status">Loading documentation…</p>}><div className="mx-auto max-w-3xl"><div className="space-y-7"><div className="space-y-3"><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your documentation</h1><p className="leading-7 text-muted-foreground">Browse saved guides and explore how your product works. Drafts are unreviewed.</p></div><Suspense fallback={<p role="status">Loading saved drafts…</p>}><SavedDraftList searchParams={searchParams} /></Suspense></div></div></Suspense>;
}
