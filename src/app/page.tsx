import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, FileCheck2, GitCompareArrows, Send } from "lucide-react";
import { MotionReveal } from "@/components/application/motion-reveal";
import { AppShell } from "@/components/application/shell";
import { LoadingList } from "@/components/application/loading-list";
import { buttonVariants } from "@/components/ui/button";
import { selectedRepository, type RepositorySearch } from "@/features/sources/repository-overview";

async function Overview({ searchParams }: { searchParams: Promise<RepositorySearch> }) {
  let repository;
  try { repository = selectedRepository(await searchParams); } catch { return <main className="p-8" role="alert">Repository selection is unavailable. Check the configured repository allowlist.</main>; }
  return <AppShell repository={repository.name} branch={repository.branch} active="Overview">
    <MotionReveal stagger className="space-y-8"><section className="max-w-3xl space-y-7 py-10 sm:py-16">
      <p data-motion-item className="text-sm font-medium text-primary">Your documentation, by your side.</p>
      <h1 data-motion-item className="text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">Your product changes.<br />Your docs should keep up.</h1>
      <p data-motion-item className="max-w-xl text-lg leading-8 text-muted-foreground">DocSyde looks at your code, identifies what changed, and prepares documentation updates for you to review.</p>
      <Link data-motion-item href={`/runs/new?${new URLSearchParams({ repository: repository.name })}`} className={buttonVariants({ size: "lg" })}>Start a run <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
      <p className="text-sm text-muted-foreground">You review the changes and decide when to publish.</p>
    </section>
    <section aria-label="How DocSyde works" className="grid gap-8 border-t py-9 md:grid-cols-3">
      {[{ Icon: GitCompareArrows, title: "Understand the change", text: "Start with your source changes and a little context about your product." }, { Icon: FileCheck2, title: "Review the update", text: "See which documentation needs attention, with the source evidence close at hand." }, { Icon: Send, title: "Publish when ready", text: "Keep proposed updates separate from the documentation people use in your app." }].map(({ Icon, title, text }) => <div data-motion-item key={title} className="space-y-3">
        <Icon className="size-5 text-primary" aria-hidden="true" />
        <h2 className="font-semibold">{title}</h2>
        <p className="max-w-sm text-sm leading-7 text-muted-foreground">{text}</p>
      </div>)}
    </section></MotionReveal>
  </AppShell>;
}
export default function Home(props: { searchParams: Promise<RepositorySearch> }) {
  return <Suspense fallback={<LoadingList />}>
    <Overview {...props} />
  </Suspense>;
}
