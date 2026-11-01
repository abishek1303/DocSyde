import { ProposalReviewForm } from "@/features/documentation/components/proposal-review-form";
import { intrinsicReviewReady } from "@/features/documentation/materialize-approved-changes";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDocumentationRun } from "@/features/documentation/run-operations";
import { RunBreadcrumbs } from "@/features/documentation/components/run-breadcrumbs";
import { getDocumentationReviewPresentation } from "@/features/documentation/review-proposal-operations";
import { AppShell } from "@/components/application/shell";
import { LoadingList } from "@/components/application/loading-list";
import { DocumentationTabs } from "@/features/documentation/components/documentation-tabs";
import { DraftInspector } from "@/features/documentation/components/draft-inspector";
async function Proposal({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fromRun?: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const review = await getDocumentationReviewPresentation(id).catch(() => null);
  if (!review) return <main className="p-8" role="alert">Proposal is unavailable. Check PostgreSQL and repository access, then reload.</main>;
  if (review.status === "missing") notFound();
  const search = await searchParams;
  const origin = search.fromRun && z.uuid().safeParse(search.fromRun).success ? await getDocumentationRun(search.fromRun).catch(() => null) : null;
  const run = origin && "schemaVersion" in origin.record && origin.record.retainedProposal?.proposalId === review.proposalId && `https://github.com/${origin.record.input.owner}/${origin.record.input.repo}`.toLowerCase() === review.repository ? origin : null;
  const repository = new URL(review.repository).pathname.slice(1);
  const expired = review.expired;
  return <AppShell repository={repository} showBranch={false} active="Documentation" headerContent={<DocumentationTabs repository={repository} selected="pending" />}>
    {run && <RunBreadcrumbs repository={repository} branch={run.record.input.branch} runId={run.id} current="Review" />}
    <Link href={`/docs?${new URLSearchParams({ repository, tab: "pending" })}`} className="text-sm underline">← Pending changes</Link>
    <header className="space-y-3">
      <h1 className="text-3xl font-semibold tracking-tight">Proposed documentation</h1>
      <p className="max-w-3xl leading-7 text-muted-foreground">{review.proposal.impact.summary}</p>
    </header>
    <p className="text-sm text-muted-foreground">Review the proposed changes below. Saving creates immutable documentation; publication is a separate action.</p>
    <ProposalReviewForm proposalId={id} proposalHash={review.proposalHash} accepted={review.review} expired={expired}
      items={review.proposal.results.map(result => ({ id: result.decisionId, action: result.decision.action,
        reason: [result.decision.reason, result.decision.updateIntent].filter(Boolean).join(" "),
        ready: (() => { try { return intrinsicReviewReady(review.proposal, result); } catch { return false; } })(),
        issues: [...result.issues, ...result.limitations] }))} />
{review.proposal.candidates.map(candidate => <section key={candidate.document.id} className="space-y-4">
      <h2 className="text-lg font-semibold">Preview: {candidate.document.title}</h2>
      <DraftInspector document={candidate.document} preview />
    </section>)}<details className="rounded-lg border p-4">
      <summary className="cursor-pointer text-sm">Review reference</summary>
      <p className="mt-3 break-all font-mono text-xs">Proposal {id}<br />Hash {review.proposalHash}</p>
    </details>
  </AppShell>;
}
export default function ProposalPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ fromRun?: string }> }) {
  return <Suspense fallback={<LoadingList />}>
    <Proposal {...props} />
  </Suspense>;
}
