import Link from "next/link";
import type { ReactNode } from "react";
import { BookOpen } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { listDocumentationDrafts } from "../operations";
import { DocumentationNavigation } from "./documentation-navigation";

export async function HelpWorkspace({ children, currentId, sections = [] }: { children: ReactNode; currentId?: string; sections?: { id: string; title: string }[] }) {
  let page;
  try { page = await listDocumentationDrafts(); } catch { /* Keep the article readable if navigation fails. */ }
  const navigation = page ? <DocumentationNavigation entries={page.entries} currentId={currentId} olderHref={page.nextCursor ? `/documentation/drafts?${new URLSearchParams({ before: page.nextCursor.savedAt, id: page.nextCursor.id })}` : undefined} /> : <p role="alert" className="text-sm text-muted-foreground">Document navigation is unavailable. Try refreshing.</p>;
  return <div className="dark min-h-screen bg-background text-foreground">
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur"><div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-5 py-4 sm:px-8"><Link href="/documentation/drafts" className="flex items-center gap-3 text-xl font-semibold tracking-tight"><BookOpen className="size-6 text-amber-400" aria-hidden="true" />DocSyde <span className="text-sm font-normal text-muted-foreground">/ Help center</span></Link><Link className={buttonVariants({ variant: "outline" })} href="/documentation/draft">Generate a draft</Link></div></header>
    <div className="mx-auto grid max-w-screen-2xl lg:grid-cols-[230px_minmax(0,1fr)_190px]">
      <aside className="border-b px-5 py-6 lg:sticky lg:top-17 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-6 lg:py-8"><div className="hidden lg:block">{navigation}</div><details className="lg:hidden"><summary className="cursor-pointer text-sm font-medium">Browse documentation</summary><div className="pt-5">{navigation}</div></details></aside>
      <main id="main-content" className="min-w-0 px-5 py-8 sm:px-9 lg:px-10 lg:py-10"><div className="mx-auto max-w-3xl"><p className="mb-8 text-sm text-muted-foreground"><Link className="underline underline-offset-4" href="/documentation/drafts">Documentation</Link>{currentId && " / Saved draft"}</p>{children}</div></main>
      <aside className="hidden border-l px-6 py-9 lg:block"><nav aria-label="Article sections" className="sticky top-25 space-y-5"><p className="text-xs font-semibold tracking-widest uppercase">On this page</p>{sections.length ? <ul className="space-y-4">{sections.map(section => <li key={section.id}><a className="text-sm leading-6 text-muted-foreground hover:text-amber-400 focus-visible:outline-2 focus-visible:outline-ring" href={`#section-${section.id}`}>{section.title}</a></li>)}</ul> : <p className="text-sm leading-6 text-muted-foreground">Choose a document to explore its sections.</p>}</nav></aside>
    </div>
  </div>;
}
