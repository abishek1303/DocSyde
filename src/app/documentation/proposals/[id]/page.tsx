import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDocumentationRun } from "@/features/documentation/runs/run-operations";
import { getDocumentationReviewPresentation } from "@/features/documentation/review/review-proposal-operations";
import { AppShell } from "@/components/application/shell";
import { LoadingList } from "@/components/application/loading-list";
import { DocumentationTabs } from "@/features/documentation/components/reader/documentation-tabs";
import { Breadcrumbs } from "@/components/application/breadcrumbs";
import { ProposalWorkspace } from "@/features/documentation/components/review/proposal-workspace";
async function Proposal({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fromRun?: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const review = await getDocumentationReviewPresentation(id).catch(() => null);
  if (!review) return <main className="p-8" role="alert">Documentation changes are unavailable. Please reload.</main>;
  if (review.status === "missing") notFound();
  const search = await searchParams, repository = new URL(review.repository).pathname.slice(1);
  const origin = search.fromRun && z.uuid().safeParse(search.fromRun).success ? await getDocumentationRun(search.fromRun).catch(() => null) : null;
  const fromRun = origin && "schemaVersion" in origin.record && origin.record.retainedProposal?.proposalId === id && `https://github.com/${origin.record.input.owner}/${origin.record.input.repo}`.toLowerCase() === review.repository ? origin.id : null;
  return <AppShell repository={repository} showBranch={false} active="Documentation" headerContent={<DocumentationTabs repository={repository} selected="pending" />}>
    <Breadcrumbs items={[{ label: "Documents", href: `/docs?${new URLSearchParams({ repository })}` }, { label: "Pending Changes", href: `/docs?${new URLSearchParams({ repository, tab: "pending" })}` }, { label: "Review changes" }]} />
    <div className="flex flex-wrap gap-5 text-sm text-primary underline"><Link href={`/docs?${new URLSearchParams({ repository, tab: "pending" })}`}>← Pending Changes</Link>{fromRun && <Link href={`/runs/${fromRun}?${new URLSearchParams({ repository })}`}>Back to run</Link>}</div>
    <header className="space-y-3"><h1 className="text-3xl font-semibold tracking-tight">Review documentation changes</h1><p className="max-w-3xl text-sm leading-7 text-muted-foreground">{review.proposal.impact.summary}</p></header>
    <ProposalWorkspace review={review} />
  </AppShell>;
}
export default function ProposalPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ fromRun?: string }> }) { return <Suspense fallback={<LoadingList />}><Proposal {...props} /></Suspense>; }
