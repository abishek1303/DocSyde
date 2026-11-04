import Link from "next/link";
import { Suspense } from "react";
import { GitBranch, Play, Send, Sparkles } from "lucide-react";
import { MotionReveal } from "@/components/application/motion-reveal";
import { AppShell } from "@/components/application/shell";
import { LoadingList } from "@/components/application/loading-list";
import { buttonVariants } from "@/components/ui/button";
import { selectedRepository, type RepositorySearch } from "@/features/sources/repository/repository-overview";
import { cn } from "@/lib/utils";

function DocumentationIllustration() {
  return <div data-motion-item aria-hidden="true" className="relative hidden w-full max-w-md justify-self-end lg:block">
    <div className="absolute inset-8 rounded-full bg-violet-500/10 blur-3xl" />
    <svg viewBox="0 0 420 320" fill="none" className="relative w-full overflow-visible">
      <defs>
        <linearGradient id="home-code-border" x1="50" y1="30" x2="250" y2="210" gradientUnits="userSpaceOnUse"><stop stopColor="#a78bfa" /><stop offset="1" stopColor="#7c3aed" stopOpacity=".3" /></linearGradient>
        <linearGradient id="home-doc-border" x1="190" y1="95" x2="395" y2="290" gradientUnits="userSpaceOnUse"><stop stopColor="#67e8f9" /><stop offset="1" stopColor="#22d3ee" stopOpacity=".3" /></linearGradient>
        <linearGradient id="home-code-fill" x1="50" y1="30" x2="250" y2="210" gradientUnits="userSpaceOnUse"><stop stopColor="#8b5cf6" stopOpacity=".14" /><stop offset="1" stopColor="#8b5cf6" stopOpacity=".03" /></linearGradient>
        <linearGradient id="home-doc-fill" x1="190" y1="95" x2="395" y2="290" gradientUnits="userSpaceOnUse"><stop stopColor="#22d3ee" stopOpacity=".18" /><stop offset="1" stopColor="#6366f1" stopOpacity=".08" /></linearGradient>
      </defs>
      <g transform="rotate(-12 155 125)">
        <rect x="36" y="32" width="214" height="178" rx="20" fill="var(--card)" />
        <rect x="36" y="32" width="214" height="178" rx="20" fill="url(#home-code-fill)" stroke="url(#home-code-border)" strokeWidth="2" />
        <path d="M37 68H249" stroke="#a78bfa" strokeOpacity=".2" />
        <g fill="#a78bfa" fillOpacity=".4"><circle cx="55" cy="50" r="3" /><circle cx="67" cy="50" r="3" /><circle cx="79" cy="50" r="3" /></g>
        <rect x="179" y="46" width="49" height="7" rx="3.5" fill="#a78bfa" fillOpacity=".16" />
        <path d="m98 106-19 16 19 16m45-32 19 16-19 16m-18-42-15 53" stroke="#a78bfa" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g transform="rotate(10 287 202)">
        <rect x="184" y="112" width="206" height="180" rx="20" fill="var(--card)" />
        <rect x="184" y="112" width="206" height="180" rx="20" fill="url(#home-doc-fill)" stroke="url(#home-doc-border)" strokeWidth="2" />
        <path d="M211 145c10-4 17-2 23 3v27c-6-5-13-7-23-3zm46 0c-10-4-17-2-23 3v27c6-5 13-7 23-3z" stroke="#22d3ee" strokeWidth="3" strokeLinejoin="round" />
        <g strokeLinecap="round"><path d="M274 153h87" stroke="#94a3b8" strokeOpacity=".3" strokeWidth="7" /><path d="M213 201h117m-117 23h143m-143 23h88" stroke="#94a3b8" strokeOpacity=".7" strokeWidth="6" /></g>
      </g>
    </svg>
  </div>;
}

async function Overview({ searchParams }: { searchParams: Promise<RepositorySearch> }) {
  let repository;
  try { repository = selectedRepository(await searchParams); } catch { return <main className="p-8" role="alert">Repository selection is unavailable. Check the configured repository allowlist.</main>; }
  return <AppShell repository={repository.name} branch={repository.branch} active="Overview">
    <MotionReveal stagger className="space-y-4">
      <section className="grid items-center gap-8 pb-12 pt-5 sm:pb-14 sm:pt-8 lg:grid-cols-[1.65fr_1fr]">
        <div className="space-y-7">
          <p data-motion-item className="text-sm font-medium text-primary">Your documentation, by your side.</p>
          <h1 data-motion-item className="text-4xl font-semibold leading-[1.18] tracking-tight sm:text-5xl">Your product changes.<br />Your docs should keep up.</h1>
          <p data-motion-item className="max-w-xl text-lg leading-8 text-muted-foreground">DocSyde looks at your code, identifies what changed, and prepares documentation updates for you.</p>
          <Link data-motion-item href={`/runs/new?${new URLSearchParams({ repository: repository.name })}`} className={cn(buttonVariants({ size: "lg" }), "h-12 gap-2.5 px-6 text-base")}><Play className="size-4" aria-hidden="true" />Start a run</Link>
        </div>
        <DocumentationIllustration />
      </section>
      <section aria-label="How DocSyde works" className="grid gap-5 border-t pt-9 md:grid-cols-3">
        {[
          { Icon: GitBranch, title: "Scan your repo changes", text: "Detect meaningful product changes as you develop.", color: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400" },
          { Icon: Sparkles, title: "AI analyzes and generates documents", text: "Understand the changes and create updated documentation.", color: "bg-primary/10 text-primary" },
          { Icon: Send, title: "Review and publish", text: "Approve the proposed updates and keep your docs in sync.", color: "bg-primary/10 text-primary" },
        ].map(({ Icon, title, text, color }) => <div data-motion-item key={title} className="flex items-start gap-5 rounded-xl border bg-card p-5 sm:p-6">
          <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-xl", color)}><Icon className="size-6" aria-hidden="true" /></span>
          <div className="space-y-3 pt-1"><h2 className="text-base font-semibold leading-6">{title}</h2><p className="text-sm leading-6 text-muted-foreground">{text}</p></div>
        </div>)}
      </section>
    </MotionReveal>
  </AppShell>;
}
export default function Home(props: { searchParams: Promise<RepositorySearch> }) {
  return <Suspense fallback={<LoadingList />}>
    <Overview {...props} />
  </Suspense>;
}
