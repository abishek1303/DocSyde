import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDocumentationDraft } from "@/features/documentation/operations";
import { DraftInspector } from "@/features/documentation/components/draft-inspector";

async function SavedDraft({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  let result;
  try { result = await getDocumentationDraft(id); }
  catch { return <p role="alert">Could not load this draft. Check PostgreSQL and migrations, then reload.</p>; }
  if (result.status === "missing") notFound();
  if (result.status === "invalid") return <div role="alert"><p>This stored draft is unavailable because its content failed validation.</p><p>{result.id} · saved {result.savedAt.toISOString()}</p></div>;
  return <DraftInspector document={result.document} savedAt={result.savedAt.toISOString()} />;
}

export default function SavedDraftPage({ params }: { params: Promise<{ id: string }> }) {
  return <main className="mx-auto w-full max-w-4xl space-y-6 px-6 py-12">
    <Link href="/documentation/drafts" className="underline">← Saved drafts</Link>
    <h1 className="text-3xl font-semibold">Saved documentation draft</h1>
    <Suspense fallback={<p role="status">Loading saved draft…</p>}><SavedDraft params={params} /></Suspense>
  </main>;
}
