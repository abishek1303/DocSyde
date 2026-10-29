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
      <p className="break-all text-sm">{entry.id}</p>
      <p className="text-sm">Saved {entry.savedAt.toISOString()}</p>
      {entry.status === "available" ? <><p className="break-all text-sm">{entry.repository}</p><p className="text-sm">Generated {entry.generatedAt}</p></> : <p>Stored content failed validation.</p>}
    </li>)}</ul>
    {page.nextCursor && <Link className="underline" href={`/documentation/drafts?${new URLSearchParams({ before: page.nextCursor.savedAt, id: page.nextCursor.id })}`}>Older drafts</Link>}
  </div>;
}

export default function SavedDraftsPage({ searchParams }: { searchParams: Search }) {
  return <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-12">
    <Link href="/documentation/draft" className="underline">Generate a draft</Link>
    <h1 className="text-3xl font-semibold">Saved documentation drafts</h1>
    <p>Unreviewed canonical drafts. Opening saved content makes no model calls.</p>
    <Suspense fallback={<p role="status">Loading saved drafts…</p>}><SavedDraftList searchParams={searchParams} /></Suspense>
  </main>;
}
