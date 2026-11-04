"use client";

import Link from "next/link";

export type DocumentationTab = "live" | "pending" | "history";
const tabs = ["live", "pending", "history"] as const;
export function DocumentationTabs({ repository, selected }: { repository: string; selected: DocumentationTab }) {
  return <nav aria-label="Documentation views" className="flex items-center gap-1 rounded-lg border border-border/70 bg-background/60 p-1">
    {tabs.map(tab => <Link key={tab} href={`/docs?${new URLSearchParams({ repository, tab })}`} aria-current={selected === tab ? "page" : undefined} className="flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-card aria-[current=page]:text-primary aria-[current=page]:shadow-sm aria-[current=page]:ring-1 aria-[current=page]:ring-border">{tab === "pending" ? "Pending changes" : tab === "history" ? "Archive" : "Latest docs"}</Link>)}
  </nav>;
}
