import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDocumentationDraft } from "@/features/documentation/operations";
import { HelpWorkspace } from "@/features/documentation/components/help-workspace";
import { DraftInspector } from "@/features/documentation/components/draft-inspector";

async function SavedDraft({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  let result;
  try { result = await getDocumentationDraft(id); }
  catch { return <p role="alert">Could not load this draft. Check PostgreSQL and migrations, then reload.</p>; }
  if (result.status === "missing") notFound();
  if (result.status === "invalid") return <div role="alert"><p>This stored draft is unavailable because its content failed validation.</p><p>{result.id} · saved {result.savedAt.toISOString()}</p></div>;
  return <HelpWorkspace currentId={result.document.id} sections={result.document.sections}><h1 className="sr-only">Saved documentation draft</h1><DraftInspector appearance="help" document={result.document} savedAt={result.savedAt.toISOString()} /></HelpWorkspace>;
}

export default function SavedDraftPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<main className="dark min-h-screen bg-background p-10 text-foreground" role="status">Loading documentation…</main>}><SavedDraft params={params} /></Suspense>;
}
