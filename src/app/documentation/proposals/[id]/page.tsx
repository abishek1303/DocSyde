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
    <p role="status" className="rounded-lg border bg-card p-5 text-sm leading-7">{expired ? "This proposal has expired. Start a new analysis to prepare a fresh proposal." : review.review ? "A review selection has been accepted. Saved documents and publication results are recorded separately." : "Ready for human review. Approval and saving currently use the review CLI documented in SETUP.md. Publishing is a separate action."}</p>
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">What needs attention</h2>
      <ul className="divide-y rounded-xl border bg-card px-6">{review.proposal.results.map(result => <li key={result.decisionId} className="space-y-2 py-5">
        <p className="text-sm font-medium">{result.decision.action.replaceAll("-", " ")} · {result.reviewReady ? "Ready for review" : "Not ready"}</p>
        <p className="text-sm leading-7">{result.decision.reason}</p>{result.decision.updateIntent && <p className="text-sm leading-7 text-muted-foreground">{result.decision.updateIntent}</p>}{result.issues.map(issue => <p key={issue} className="text-sm text-muted-foreground">{issue}</p>)}</li>)}</ul>
    </section>{review.proposal.candidates.map(candidate => <section key={candidate.document.id} className="space-y-4">
      <h2 className="text-lg font-semibold">Preview: {candidate.document.title}</h2>
      <DraftInspector document={candidate.document} />
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
