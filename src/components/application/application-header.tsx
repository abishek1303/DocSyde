"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BookOpen, House, History, Brain, Plug, ScanLine, ClipboardList } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";

function Navigation() {
  const pathname = usePathname();
  const search = useSearchParams();
  const query = new URLSearchParams();
  const selected = search.get("repository");
  let repository = selected;
  if (selected?.startsWith("https://github.com/")) {
    try { repository = new URL(selected).pathname.slice(1); } catch { repository = null; }
  }
  if (repository) query.set("repository", repository);
  const branch = search.get("branch");
  if (branch) query.set("branch", branch);
  const suffix = query.size ? `?${query}` : "";
  const links = [
    { label: "Overview", href: "/", icon: House, active: pathname === "/" },
    { label: "Understand product", href: "/sources/understanding", icon: Brain, active: pathname === "/sources/understanding" },
    { label: "Your runs", href: "/runs", icon: History, active: (pathname.startsWith("/runs") && !pathname.includes("/model-failure/")) || pathname.startsWith("/changes") || (pathname.startsWith("/sources") && pathname !== "/sources/understanding") },
    { label: "Documents", href: "/docs", icon: BookOpen, active: pathname.startsWith("/docs") || pathname.startsWith("/documentation") },
    { label: "Logs", href: "/ai-model-usage", icon: ClipboardList, active: pathname.startsWith("/ai-model-usage") || pathname.includes("/model-failure/") },
    { label: "AI / MCP", href: "/ai", icon: Plug, active: pathname === "/ai" || pathname.startsWith("/ai/") },
  ];
  return <>
    <Link href={`/${suffix}`} aria-label="DocSyde overview" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
      <ScanLine className="size-5" aria-hidden="true" />
    </Link>
    <nav aria-label="Main navigation" className="flex min-w-0 flex-1 justify-around gap-1 md:mt-8 md:flex-col md:justify-start md:gap-3">
      {links.map(({ label, href, icon: Icon, active }) => <Link key={href} href={`${href}${suffix}`} aria-label={label} aria-current={active ? "page" : undefined} className="group relative flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-accent aria-[current=page]:text-primary md:size-11 md:p-0">
        <Icon className="size-5" aria-hidden="true" />
        <span className="whitespace-nowrap text-[10px] md:hidden">{label}</span>
        <span aria-hidden="true" className="pointer-events-none absolute left-full z-50 ml-3 hidden whitespace-nowrap rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-sm group-hover:block group-focus-visible:block max-md:invisible">{label}</span>
      </Link>)}
    </nav>
  </>;
}

export function ApplicationHeader() {
  return <aside className="sticky top-0 z-40 flex shrink-0 items-center gap-2 border-b bg-card px-3 py-3 md:fixed md:inset-y-0 md:left-0 md:w-20 md:flex-col md:border-r md:border-b-0 md:py-6">
    <Suspense fallback={<span className="sr-only">Loading navigation</span>}>
      <Navigation />
    </Suspense>
    <div className="hidden md:block">
      <ThemeToggle />
    </div>
  </aside>;
}
