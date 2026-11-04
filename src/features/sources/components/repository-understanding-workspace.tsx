"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { ArrowRight, BookOpen, CodeXml, GitBranch, Layers3, Play, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RepositoryUnderstanding } from "../context/understanding";
import { RepositoryUnderstandingForm } from "./repository-understanding-form";

const sections = [
  ["workflows", "What people can do"], ["surfaces", "Product areas"],
  ["terminology", "Product terminology"], ["gaps", "What needs more context"],
] as const;

export function RepositoryUnderstandingWorkspace({ repository, revision, branches, saved, savedProductContext }: {
  repository: string; revision: string; branches: string[]; saved: RepositoryUnderstanding | null; savedProductContext: string;
}) {
  const [setupOpen, setSetupOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeSetup = useCallback(() => { setSetupOpen(false); requestAnimationFrame(() => trigger.current?.focus()); }, []);
  if (setupOpen) return <section aria-label={saved ? "Rescan repository" : "Analyze repository"} className="mx-auto max-w-3xl space-y-6">
    <h1 className="text-3xl font-semibold tracking-tight">{saved ? "Rescan repository" : "Analyze repository"}</h1>
    <RepositoryUnderstandingForm repository={repository} revision={revision} branches={branches} exists={Boolean(saved)} savedProductContext={savedProductContext} onCancel={closeSetup} onComplete={closeSetup} />
  </section>;
  return <div className="space-y-8">
    <header className="flex flex-wrap items-start justify-between gap-5">
      <div className="max-w-2xl space-y-3"><h1 className="text-3xl font-semibold tracking-tight">Product understanding</h1>
        <p className="text-sm leading-7 text-muted-foreground">What DocSyde knows about your product, its users, and how it works. Used as context for future documentation runs.</p>
      </div>
      {saved && <Button ref={trigger} variant="outline" size="lg" onClick={() => setSetupOpen(true)}><RefreshCw aria-hidden="true" />Rescan repository</Button>}
    </header>
    {saved ? <>
      <section aria-label="Saved product understanding" className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2"><BookOpen className="size-4 text-primary" aria-hidden="true" />Repository understanding</span>
          <span>Last analyzed {new Date(saved.analyzedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} · <span className="font-mono">{saved.sha.slice(0, 7)}</span></span>
        </div>
        <div className="grid gap-8 p-6 sm:p-8 md:grid-cols-[2fr_1fr]">
          <div className="space-y-3"><h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Product purpose</h2><p className="text-lg leading-8">{saved.summary.purpose}</p></div>
          <div className="space-y-3"><h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Who it’s for</h2><p className="text-sm leading-7">{saved.summary.audience}</p></div>
        </div>
      </section>
      <div className="grid gap-5 md:grid-cols-2">{sections.map(([key, title]) => <section key={key} className="space-y-5 rounded-xl border bg-card p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold">{key === "gaps" ? <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" /> : <Layers3 className="size-4 text-primary" aria-hidden="true" />}{title}</h2>
        {saved.summary[key].length ? <ul className="space-y-3 text-sm leading-7 text-muted-foreground">{saved.summary[key].map((text, i) => <li key={i} className="flex gap-3"><span className="mt-3 size-1 shrink-0 rounded-full bg-primary/50" aria-hidden="true" /><span>{text}</span></li>)}</ul>
          : <p className="text-sm leading-7 text-muted-foreground">{key === "gaps" ? "No additional gaps were recorded in this analysis." : "No details captured yet. Rescan the repository with more product context to explore this area."}</p>}
      </section>)}</div>
      <div className="flex flex-wrap items-start justify-between gap-5 border-t pt-5">
        <details className="max-w-full text-xs text-muted-foreground"><summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">Analysis details · {saved.files.length} files inspected</summary>
          <p className="mt-3 leading-6">{saved.generationContext ? saved.generationContext.productContextUsed ? "Analyzed with advisory product context." : "Repository-only analysis; no product context supplied." : "Historical analysis; context usage was not recorded."}</p>
          <p className="mt-2 leading-6">Advisory context only. Documentation runs verify source and runtime evidence independently.</p>
          <ul className="mt-3 space-y-2">{saved.files.map(file => <li key={file.path} className="break-all"><code>{file.path}</code> · SHA256 {file.sha256.slice(0, 12)}</li>)}</ul>
        </details>
        <Link href={`/runs/new?${new URLSearchParams({ repository, branch: revision })}`} className="inline-flex items-center gap-2 rounded-sm text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">Generate documentation<ArrowRight className="size-4" aria-hidden="true" /></Link>
      </div>
    </> : <section aria-label="No product understanding" className="flex min-h-96 flex-col items-center justify-center rounded-xl border bg-card px-6 py-14 text-center sm:py-20">
      <div aria-hidden="true" className="relative mb-7 flex h-28 w-36 items-center justify-center">
        <div className="absolute bottom-2 h-16 w-24 rotate-[-12deg] rounded-2xl border border-violet-400/20 bg-violet-500/5" />
        <div className="absolute bottom-5 h-16 w-24 rotate-[-12deg] rounded-2xl border border-violet-400/30 bg-violet-500/10" />
        <div className="relative -translate-y-2 rotate-[-12deg] rounded-2xl border border-violet-400/40 bg-gradient-to-br from-violet-500/25 to-indigo-500/10 px-6 py-4 text-violet-500 dark:text-violet-300"><CodeXml className="size-10" strokeWidth={1.5} /></div>
        <Sparkles className="absolute -right-1 top-0 size-6 text-violet-500 dark:text-violet-300" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight">No product understanding yet</h2>
      <p className="mt-3 max-w-md text-sm leading-7 text-muted-foreground">Analyze your repository to build a shared understanding of your product before generating documentation.</p>
      <Button ref={trigger} size="lg" className="mt-7 px-5" onClick={() => setSetupOpen(true)}><Play aria-hidden="true" />Analyze repository</Button>
      <span className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><GitBranch className="size-3" aria-hidden="true" />Choose a branch and add optional context before starting.</span>
    </section>}
  </div>;
}
