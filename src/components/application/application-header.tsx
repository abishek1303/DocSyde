"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BookOpen, ArrowUpRight } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";

function HeaderLinks({ pathname = "", query = "" }: { pathname?: string; query?: string }) {
  const suffix = query ? `?${query}` : "";
  const documentation = pathname.startsWith("/docs") || pathname.startsWith("/documentation");
  return <>
    <Link href={`/${suffix}`} className="flex items-center gap-2 font-semibold tracking-tight"><BookOpen className="size-5 text-primary" aria-hidden="true" />DocSyde</Link>
    <nav aria-label="Main navigation" className="flex flex-wrap gap-1">{[["Overview", "/", pathname === "/"], ["Changes", "/changes", pathname.startsWith("/changes")], ["Documentation", "/docs", documentation]].map(([label, path, active]) => <Link key={String(path)} href={`${path}${suffix}`} aria-current={active ? "page" : undefined} className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-primary focus-visible:outline-2 focus-visible:outline-ring">{label}</Link>)}</nav>
    <Link href={`/sources${suffix}`} className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline">Source tools<ArrowUpRight className="size-3" aria-hidden="true" /></Link>
  </>;
}

function ContextLinks() {
  const pathname = usePathname();
  const search = useSearchParams();
  const query = new URLSearchParams();
  let repository = search.get("repository");
  if (repository?.startsWith("https://github.com/")) {
    try { repository = new URL(repository).pathname.slice(1); } catch { repository = null; }
  }
  if (repository) query.set("repository", repository);
  const branch = search.get("branch");
  if (branch) query.set("branch", branch);
  return <HeaderLinks pathname={pathname} query={query.toString()} />;
}

export function ApplicationHeader() {
  return <header className="sticky top-0 z-30 border-b bg-card/95 text-foreground backdrop-blur">
    <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
      <Suspense fallback={<HeaderLinks />}><ContextLinks /></Suspense>
      <ThemeToggle />
    </div>
  </header>;
}
