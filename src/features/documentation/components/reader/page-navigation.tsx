"use client";

import Link from "next/link";
import { useState } from "react";
import { Search, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";

export function PageNavigation({ entries, currentId, backHref }: { entries: { id: string; title: string; href: string }[]; currentId?: string; backHref?: string }) {
  const [query, setQuery] = useState("");
  const filtered = entries.filter(entry => entry.title.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="flex min-h-0 flex-col gap-5">
    {backHref && <Link href={backHref} className="text-xs font-medium text-primary hover:underline">← All versions</Link>}
    <div className="relative"><Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" aria-hidden="true" /><Input aria-label="Search pages" placeholder="Search pages…" value={query} onChange={event => setQuery(event.target.value)} className="pl-9" /></div>
    <nav aria-label="Documentation pages"><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pages</p><ul className="space-y-1">{filtered.map(entry => <li key={entry.id}><Link href={entry.href} aria-current={entry.id === currentId ? "page" : undefined} className="flex items-start gap-2 rounded-md px-3 py-2.5 text-sm leading-6 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-primary"><FileText className="mt-1 size-4 shrink-0" aria-hidden="true" /><span className="break-words">{entry.title}</span></Link></li>)}</ul>{!filtered.length && <p role="status" className="text-sm text-muted-foreground">No matching pages.</p>}</nav>
  </div>;
}
