import type { ReactNode } from "react";
import { Archive, BookOpen, FileCheck2, Play, Sparkles } from "lucide-react";

const illustrations = { runs: Play, pending: FileCheck2, documents: BookOpen, archive: Archive };

/** Shared empty-state treatment for the run and documentation workspaces. */
export function IllustratedEmptyState({ kind, title, action, headingLevel = "h2" }: {
  kind: keyof typeof illustrations; title: string; action: ReactNode; headingLevel?: "h1" | "h2";
}) {
  const Icon = illustrations[kind], Heading = headingLevel;
  return <section aria-label={title} className="flex min-h-96 flex-col items-center justify-center rounded-xl border bg-card px-6 py-14 text-center sm:min-h-[420px] sm:py-16">
    <div aria-hidden="true" className="relative mb-7 flex h-28 w-40 items-center justify-center">
      <div className="absolute inset-3 rounded-full bg-violet-500/10 blur-2xl" />
      {kind !== "documents" && <div className="absolute left-5 top-3 h-20 w-28 -rotate-6 rounded-xl border border-violet-400/20 bg-violet-500/5" />}
      <div className={`relative flex items-center justify-center text-violet-500 dark:text-violet-300 ${kind === "documents" ? "h-24 w-32" : "h-22 w-28 rounded-xl border border-violet-400/35 bg-gradient-to-br from-violet-500/20 to-indigo-500/10"}`}>
        <Icon className={kind === "documents" ? "size-24" : "size-14"} strokeWidth={1.25} />
      </div>
      <Sparkles className="absolute right-0 top-0 size-6 text-violet-500 dark:text-violet-300" strokeWidth={1.5} />
    </div>
    <Heading className="text-2xl font-semibold tracking-tight">{title}</Heading>
    <div className="mt-7 flex flex-wrap justify-center gap-3">{action}</div>
  </section>;
}
