import { getPublication, savedDocumentCoordinates } from "@/features/documentation/publication-operations";
import { PublicationControls } from "@/features/documentation/components/publication-controls";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDocumentationDraft } from "@/features/documentation/operations";
import { ArticleSkeleton } from "@/features/documentation/components/article-skeleton";
import { DraftInspector } from "@/features/documentation/components/draft-inspector";

async function SavedDraft({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ repository?: string; route?: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const search = await searchParams;
  const repository = search.repository;
  let result;
  try { result = await getDocumentationDraft(id, repository); }
  catch { return <p role="alert">Could not load this draft. Check PostgreSQL and migrations, then reload.</p>; }
  if (result.status === "missing") notFound();
  if (result.status === "invalid") return <div role="alert"><p>This stored draft is unavailable because its content failed validation.</p><p>{result.id} · saved {result.savedAt.toISOString()}</p></div>;
  let published = false;
  if (search.route) {
    try {
      const publication = await getPublication({ ...savedDocumentCoordinates(result.document.provenance.repository), route: search.route });
      published = publication?.draftId === result.document.id;
    } catch { /* Publication lookup must not prevent reading a saved document. */ }
  }
  return <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[minmax(0,1fr)_170px]"><div className="min-w-0"><h1 className="sr-only">{published ? "Published documentation" : "Saved documentation"}</h1><PublicationControls draftId={result.document.id} repository={result.document.provenance.repository} /><DraftInspector published={published} appearance="help" document={result.document} savedAt={result.savedAt.toISOString()} /></div><aside className="hidden lg:block"><nav aria-label="Section navigation" className="sticky top-6 space-y-4"><p className="text-xs font-semibold uppercase">On this page</p>{result.document.sections.map(section => <a key={section.id} href={`#section-${section.id}`} className="block text-sm text-muted-foreground hover:text-primary">{section.title}</a>)}</nav></aside></div>;
}

export default function SavedDraftPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ repository?: string; route?: string }> }) {
  return <Suspense fallback={<ArticleSkeleton />}><SavedDraft params={params} searchParams={searchParams} /></Suspense>;
}
