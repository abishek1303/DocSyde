import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDocumentationDraft } from "@/features/documentation/operations";
import { ArticleSkeleton } from "@/features/documentation/components/article-skeleton";
import { DraftInspector } from "@/features/documentation/components/draft-inspector";

async function SavedDraft({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ repository?: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const repository = (await searchParams).repository;
  let result;
  try { result = await getDocumentationDraft(id, repository); }
  catch { return <p role="alert">Could not load this draft. Check PostgreSQL and migrations, then reload.</p>; }
  if (result.status === "missing") notFound();
  if (result.status === "invalid") return <div role="alert"><p>This stored draft is unavailable because its content failed validation.</p><p>{result.id} · saved {result.savedAt.toISOString()}</p></div>;
  return <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[minmax(0,1fr)_170px]"><div className="min-w-0"><h1 className="sr-only">Saved documentation draft</h1><DraftInspector appearance="help" document={result.document} savedAt={result.savedAt.toISOString()} /></div><aside className="hidden lg:block"><nav aria-label="Section navigation" className="sticky top-25 space-y-4"><p className="text-xs font-semibold uppercase">On this page</p>{result.document.sections.map(section => <a key={section.id} href={`#section-${section.id}`} className="block text-sm text-muted-foreground hover:text-primary">{section.title}</a>)}</nav></aside></div>;
}

export default function SavedDraftPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ repository?: string }> }) {
  return <Suspense fallback={<ArticleSkeleton />}><SavedDraft params={params} searchParams={searchParams} /></Suspense>;
}
