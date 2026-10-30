import { RepositoryBranch } from "@/features/sources/components/repository-branch";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell } from "@/components/application/shell";
import { LoadingList } from "@/components/application/loading-list";
import { DocumentationList } from "@/features/documentation/components/draft-library";
import { CommitList } from "@/features/sources/components/recent-commits";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { selectedRepository, type RepositorySearch } from "@/features/sources/repository-overview";
async function HomeContent({ searchParams }: { searchParams: Promise<RepositorySearch> }) {
  let repository;
  try { repository = selectedRepository(await searchParams); } catch { return <main className="p-8" role="alert">Repository selection is unavailable. Check the configured repository allowlist.</main>; }
  const query = new URLSearchParams({ repository: repository.name, ...(repository.branch ? { branch: repository.branch } : {}) });
  return <AppShell repository={repository.name} branch={repository.branch} branchContext={<RepositoryBranch repository={repository} />} active="Overview"><header className="space-y-3"><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your product, documented.</h1><p className="max-w-xl leading-7 text-muted-foreground">Explore saved documentation or catch up on recent source changes.</p></header><div className="grid min-w-0 gap-6 md:grid-cols-2">{[{ title: "Documentation", description: "Your latest saved drafts. Unreviewed and ready to read.", href: "/docs", action: "View documentation", content: <DocumentationList repository={repository.location} limit={4} /> }, { title: "Recent changes", description: "The latest commits from your selected GitHub branch.", href: "/changes", action: "View changes", content: <CommitList repository={repository} limit={4} /> }].map(panel => <Card key={panel.title} className="min-w-0"><CardHeader><h2 className="text-xl font-semibold">{panel.title}</h2><p className="text-sm leading-6 text-muted-foreground">{panel.description}</p><Link className={buttonVariants({ variant: "outline" })} href={`${panel.href}?${query}`}>{panel.action}</Link></CardHeader><CardContent className="min-w-0"><Suspense fallback={<LoadingList />}>{panel.content}</Suspense></CardContent></Card>)}</div></AppShell>;
}

export default function Home(props: { searchParams: Promise<RepositorySearch> }) { return <Suspense fallback={<LoadingList />}><HomeContent {...props} /></Suspense>; }
