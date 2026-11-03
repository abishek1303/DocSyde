"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUp, ChevronDown, FileText, Menu, Search } from "lucide-react";
import { MotionReveal } from "@/components/application/motion-reveal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Section = { id: string; title: string };
export function DocumentationReader({ title, sections, children, backHref, view }: { title: string; sections: Section[]; children: ReactNode; backHref: string; view: "Latest" | "Archive" }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const matches = title.toLowerCase().includes(query.trim().toLowerCase());
  const behavior = (): ScrollBehavior => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
  function jump(id: string) {
    const pane = viewport.current;
    const target = document.getElementById(`section-${id}`);
    if (!pane || !target || !pane.contains(target)) return;
    pane.scrollTo({ top: target.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - 24, behavior: behavior() });
    setActive(id);
    setMenuOpen(false);
    setSectionsOpen(false);
  }
  useEffect(() => {
    const pane = viewport.current;
    if (!pane) return;
    function updateActive() {
      if (!pane) return;
      let current = sections[0]?.id ?? "";
      for (const section of sections) {
        const node = document.getElementById(`section-${section.id}`);
        if (node && node.getBoundingClientRect().top <= pane.getBoundingClientRect().top + 100) current = section.id;
      }
      if (pane.scrollHeight > pane.clientHeight && pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2) current = sections.at(-1)?.id ?? current;
      setActive(current);
    }
    pane.addEventListener("scroll", updateActive, { passive: true });
    return () => pane.removeEventListener("scroll", updateActive);
  }, [sections]);
  const topicNavigation = <div className="flex min-h-0 flex-1 flex-col gap-6">
    <div className="relative shrink-0">
      <Search aria-hidden="true" className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" />
      <Input aria-label="Search documents" placeholder="Find a document…" value={query} onChange={event => setQuery(event.target.value)} className="pl-9" />
    </div>
    <nav aria-label="Documents" className="min-h-0 overflow-y-auto overscroll-contain">
      <details open className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase [&::-webkit-details-marker]:hidden">{view === "Latest" ? "Saved document" : "Historical version"}<ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        {matches ? <button type="button" aria-current="page" onClick={() => { viewport.current?.scrollTo({ top: 0, behavior: behavior() }); setMenuOpen(false); }} className="mt-4 flex w-full items-start gap-3 rounded-md bg-accent px-3 py-3 text-left text-sm font-medium leading-6 text-primary focus-visible:outline-2 focus-visible:outline-ring">
          <FileText aria-hidden="true" className="mt-1 size-4 shrink-0" />{title}
        </button> : <p role="status" className="mt-4 text-sm text-muted-foreground">No matching documents.</p>}
      </details>
    </nav>
  </div>;
  const sectionNavigation = <ul className="space-y-3">{sections.map(section => <li key={section.id}>
    <a href={`#section-${section.id}`} aria-current={active === section.id ? "location" : undefined} onClick={event => { event.preventDefault(); jump(section.id); }} className="block text-sm leading-6 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current=location]:font-medium aria-[current=location]:text-primary">{section.title}</a>
  </li>)}</ul>;
  return <div className="mx-auto grid h-full min-h-0 w-full max-w-screen-2xl gap-6 px-5 lg:grid-cols-[220px_minmax(0,1fr)_180px] lg:gap-8 lg:px-8 xl:grid-cols-[240px_minmax(0,1fr)_200px]">
    <aside aria-label="Documentation navigation" className="hidden min-h-0 flex-col border-r py-7 pr-6 lg:flex">{topicNavigation}</aside>
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="shrink-0 space-y-4 border-b py-4 lg:border-0 lg:py-6">
        <div className="flex items-center gap-3 lg:hidden">
          <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
            <DialogTrigger render={<Button variant="outline" size="icon" aria-label="Browse documents" />}>
              <Menu aria-hidden="true" />
            </DialogTrigger>
            <DialogContent className="flex h-dvh max-h-dvh max-w-full flex-col rounded-none p-6 sm:max-w-full">
              <DialogTitle className="mb-4 text-lg font-semibold">Documentation</DialogTitle>{topicNavigation}
            </DialogContent>
          </Dialog>
          <details open={sectionsOpen} onToggle={event => setSectionsOpen(event.currentTarget.open)} className="relative min-w-0 flex-1 rounded-md border bg-card">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
              <span className="truncate">{sections.find(section => section.id === active)?.title ?? "On this page"}</span>
              <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
            </summary>
            <nav aria-label="On this page" className="absolute inset-x-0 top-full z-10 mt-2 max-h-64 overflow-y-auto rounded-lg border bg-popover p-4 shadow-lg">{sectionNavigation}</nav>
          </details>
        </div>
        <nav aria-label="Document breadcrumb" className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <Link href={backHref} className="shrink-0 hover:text-foreground underline-offset-4 hover:underline">Documentation</Link>
          <span aria-hidden="true">/</span>
          <span className="shrink-0">{view}</span>
          <span aria-hidden="true">/</span>
          <span className="truncate" title={title}>{title}</span>
        </nav>
      </div>
      <div ref={viewport} data-scroll-viewport tabIndex={0} aria-label="Document article" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
        <div className="mx-auto max-w-[860px] pt-6 lg:pt-2"><MotionReveal key={`${view}:${backHref}:${title}`}>{children}</MotionReveal>
          <footer className="mt-12 border-t pt-6">
            <button type="button" onClick={() => viewport.current?.scrollTo({ top: 0, behavior: behavior() })} className="mx-auto flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-ring">
              <ArrowUp aria-hidden="true" className="size-4" />Back to top</button>
          </footer>
        </div>
      </div>
    </div>
    <aside className="hidden min-h-0 flex-col border-l py-7 pl-6 lg:flex">
      <p className="mb-5 shrink-0 text-xs font-semibold tracking-wider uppercase">On this page</p>
      <nav aria-label="On this page" className="min-h-0 overflow-y-auto overscroll-contain">{sectionNavigation}</nav>
    </aside>
  </div>;
}
