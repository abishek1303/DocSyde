"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { loadDocumentationNavigation } from "@/app/documentation/drafts/navigation-actions";
import { buttonVariants } from "@/components/ui/button";
import { DocumentationNavigation } from "./documentation-navigation";

type Navigation = Awaited<ReturnType<typeof loadDocumentationNavigation>>;

export function ReaderWorkspace({ children }: { children: ReactNode }) {
  const search = useSearchParams();
  const pathname = usePathname();
  const repository = search.get("repository") ?? undefined;
  const [navigation, setNavigation] = useState<{ repository?: string; data?: Navigation; failed?: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    loadDocumentationNavigation(repository).then(data => {
      if (active) setNavigation({ repository, data });
    }).catch(() => {
      if (active) setNavigation({ repository, failed: true });
    });
    return () => { active = false; };
  }, [repository]);
  let repositoryName: string | undefined;
  try { repositoryName = repository ? new URL(repository).pathname.slice(1) : undefined; } catch { /* Server operations validate the scope. */ }
  const libraryHref = `/docs?${new URLSearchParams({ view: "library", ...(repositoryName ? { repository: repositoryName } : {}) })}`;
  const currentId = pathname.split("/")[3];
  const current = navigation?.repository === repository ? navigation : null;
  const sidebar = current?.data ? <DocumentationNavigation entries={current.data.entries} repository={repository} currentId={currentId} olderHref={current.data.hasOlder ? libraryHref : undefined} /> : current?.failed ? <p role="alert" className="text-sm text-muted-foreground">Document navigation is unavailable. Refresh to retry.</p> : <p role="status" className="text-sm text-muted-foreground">Loading navigation…</p>;
  return <div className="min-h-screen bg-background text-foreground">
    <div className="mx-auto grid max-w-screen-2xl lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="border-b px-5 py-6 lg:sticky lg:top-21 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-6 lg:py-8"><Link href="/documentation/draft" className={`${buttonVariants({ variant: "outline" })} mb-6`}>Generate a draft</Link><div className="hidden lg:block">{sidebar}</div><details className="lg:hidden"><summary className="cursor-pointer text-sm font-medium">Browse documentation</summary><div className="pt-5">{sidebar}</div></details></aside>
      <main id="main-content" className="min-w-0 px-5 py-8 sm:px-9 lg:px-10 lg:py-10">{children}</main>
    </div>
  </div>;
}
