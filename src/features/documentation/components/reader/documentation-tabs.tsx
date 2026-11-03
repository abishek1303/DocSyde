"use client";

import Link from "next/link";

export type DocumentationTab = "live" | "pending" | "history";
const tabs = ["live", "pending", "history"] as const;
export function DocumentationTabs({ repository, selected }: { repository: string; selected: DocumentationTab }) {
  return <nav aria-label="Documentation views" className="relative isolate grid h-9 w-64 grid-cols-3 rounded-lg bg-muted p-1 sm:w-80">
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-1 left-1 -z-10 w-[calc((100%-0.5rem)/3)] rounded-md bg-accent shadow-sm ring-1 ring-primary/25 transition-transform duration-250 ease-out motion-reduce:transition-none" style={{ transform: `translateX(${tabs.indexOf(selected) * 100}%)` }} />
    {tabs.map(tab => <Link key={tab} href={`/docs?${new URLSearchParams({ repository, tab })}`} aria-current={selected === tab ? "page" : undefined} className="flex items-center justify-center rounded-md px-2 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:text-primary">{tab === "pending" ? <><span className="sm:hidden">Pending</span><span className="hidden sm:inline">Pending changes</span></> : tab === "history" ? "History" : "Live"}</Link>)}
  </nav>;
}
