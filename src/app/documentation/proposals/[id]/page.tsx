import { ProposalReviewForm } from "@/features/documentation/components/review/proposal-review-form";
import { intrinsicReviewReady } from "@/features/documentation/review/materialize-approved-changes";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDocumentationRun } from "@/features/documentation/runs/run-operations";
import { RunBreadcrumbs } from "@/features/documentation/components/runs/run-breadcrumbs";
import { getDocumentationReviewPresentation } from "@/features/documentation/review/review-proposal-operations";
import { AppShell } from "@/components/application/shell";
import { LoadingList } from "@/components/application/loading-list";
import { DocumentationTabs } from "@/features/documentation/components/reader/documentation-tabs";
import { DraftMarkdown } from "@/features/documentation/components/reader/draft-markdown";
import { Breadcrumbs } from "@/components/application/breadcrumbs";
import { DraftInspector } from "@/features/documentation/components/reader/draft-inspector";
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
    <Breadcrumbs items={[{ label: "Documents", href: `/docs?${new URLSearchParams({ repository })}` }, { label: "Pending changes", href: `/docs?${new URLSearchParams({ repository, tab: "pending" })}` }, { label: "Review documentation" }]} />
    {run && <RunBreadcrumbs repository={repository} branch={run.record.input.branch} runId={run.id} current="Review" />}
    <Link href={`/docs?${new URLSearchParams({ repository, tab: "pending" })}`} className="text-sm underline">← Pending changes</Link>
    <header className="space-y-3">
      <h1 className="text-3xl font-semibold tracking-tight">Proposed documentation</h1>
      <p className="max-w-3xl leading-7 text-muted-foreground">{review.proposal.impact.summary}</p>
    </header>
    <p className="text-sm text-muted-foreground">Review the proposed changes below. Saving creates immutable documentation; publication is a separate action.</p>
    {review.proposal.results.filter(result => result.change && result.change.kind !== "incomplete").map(result => {
      const baseline = review.proposal.targets.find(target => target.document.id === result.decision.documentId)?.document;
      const section = baseline?.sections.find(section => section.id === result.decision.sectionId);
      const candidate = review.proposal.candidates.find(candidate => candidate.document.id === result.candidateId)?.document;
      const change = result.change;
      const proposed = change?.kind === "replace-section" || change?.kind === "add-section" ? change.section : null;
      return <section key={result.decisionId} className="overflow-hidden rounded-xl border bg-card">
        <header className="border-b px-5 py-4"><h2 className="font-semibold">{baseline?.title ?? candidate?.title ?? "New document"}{section ? ` / ${section.title}` : ""}</h2><p className="mt-1 text-sm text-muted-foreground">{result.decision.reason}</p></header>
        <div className="grid divide-y md:grid-cols-2 md:divide-x md:divide-y-0"><div className="space-y-3 p-5"><h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current saved text</h3>{section ? section.content.map((block, i) => <DraftMarkdown key={i} content={block.markdown} />) : baseline ? baseline.sections.map(section => <div key={section.id}><h4 className="font-medium">{section.title}</h4>{section.content.map((block, i) => <DraftMarkdown key={i} content={block.markdown} />)}</div>) : <p className="text-sm text-muted-foreground">No existing content.</p>}</div>
          <div className="space-y-3 bg-accent/25 p-5"><h3 className="text-xs font-medium uppercase tracking-wide text-primary">Proposed change</h3>{proposed ? proposed.content.map((block, i) => <DraftMarkdown key={i} content={block.markdown} />) : <p className="text-sm">See the complete candidate below.</p>}<p className="text-xs text-muted-foreground">Evidence support: {result.support}</p></div></div>
        <details className="border-t px-5 py-3"><summary className="cursor-pointer text-xs text-muted-foreground">Evidence and qualifications</summary><ul className="mt-3 space-y-2 text-xs leading-6 text-muted-foreground">{result.limitations.map((text, i) => <li key={i}>{text}</li>)}</ul></details>
      </section>;
    })}
    <ProposalReviewForm proposalId={id} proposalHash={review.proposalHash} accepted={review.review} expired={expired}
      items={review.proposal.results.map(result => ({ id: result.decisionId, action: result.decision.action,
        reason: [result.decision.reason, result.decision.updateIntent].filter(Boolean).join(" "),
        ready: (() => { try { return intrinsicReviewReady(review.proposal, result); } catch { return false; } })(),
        issues: result.issues }))} />
{review.proposal.candidates.map(candidate => <details key={candidate.document.id} className="space-y-4 rounded-xl border p-5">
      <summary className="cursor-pointer text-sm font-medium">Full candidate: {candidate.document.title}</summary>
      <DraftInspector document={candidate.document} preview />
    </details>)}<details className="rounded-lg border p-4">
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
