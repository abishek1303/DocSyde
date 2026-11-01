"use client";

import Link from "next/link";

export type DocumentationTab = "latest" | "pending" | "archive";
const tabs = ["latest", "pending", "archive"] as const;
export function DocumentationTabs({ repository, selected }: { repository: string; selected: DocumentationTab }) {
  return <nav aria-label="Documentation views" className="relative isolate grid h-9 w-56 grid-cols-3 rounded-lg bg-muted p-1 sm:w-64">
    <span aria-hidden="true" className="pointer-events-none absolute inset-y-1 left-1 -z-10 w-[calc((100%-0.5rem)/3)] rounded-md bg-accent shadow-sm ring-1 ring-primary/25 transition-transform duration-250 ease-out motion-reduce:transition-none" style={{ transform: `translateX(${tabs.indexOf(selected) * 100}%)` }} />
    {tabs.map(tab => <Link key={tab} href={`/docs?${new URLSearchParams({ repository, tab })}`} aria-current={selected === tab ? "page" : undefined} className="flex items-center justify-center rounded-md px-2 text-xs font-medium capitalize text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:text-primary sm:text-sm">{tab}</Link>)}
  </nav>;
}
