"use client";
import Link from "next/link";
import { useId, useState } from "react";
import { FileText, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

type Entry = { id: string; status: "available" | "unavailable"; title?: string };
export function DocumentationNavigation({ entries, currentId, olderHref }: { entries: Entry[]; currentId?: string; olderHref?: string }) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const filtered = entries.filter(entry => (entry.title ?? "Unavailable draft").toLowerCase().includes(query.toLowerCase()));
  return <nav aria-label="Saved documentation" className="space-y-6">
    <div className="space-y-2"><label htmlFor={inputId} className="flex items-center gap-2 text-sm font-medium"><Search className="size-4" aria-hidden="true" /> Find a document</label><Input id={inputId} placeholder="Filter these titles…" value={query} onChange={event => setQuery(event.target.value)} /><p className="text-xs text-muted-foreground">Filters the latest {entries.length} saved drafts.</p></div>
    <div><p className="mb-3 text-xs font-semibold tracking-widest text-muted-foreground uppercase">Documentation</p><ul className="space-y-1">{filtered.map(entry => <li key={entry.id}><Link aria-current={entry.id === currentId ? "page" : undefined} className="flex items-start gap-3 rounded-md px-3 py-3 text-sm leading-6 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-amber-500/10 aria-[current=page]:text-amber-400" href={`/documentation/drafts/${entry.id}`}><FileText className="mt-1 size-4 shrink-0" aria-hidden="true" />{entry.status === "available" ? entry.title : "Unavailable draft"}</Link></li>)}</ul>{!filtered.length && <p role="status" className="text-sm text-muted-foreground">{entries.length ? "No matching titles on this page." : "No saved documents yet."}</p>}</div>
    {olderHref && <Link href={olderHref} className="text-sm underline underline-offset-4">Browse older drafts →</Link>}
  </nav>;
}
