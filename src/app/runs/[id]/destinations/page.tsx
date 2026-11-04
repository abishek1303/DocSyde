import { PageLoader } from "@/components/application/page-loader";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/application/shell";
import { readStoredDocumentationRun } from "@/features/documentation/runs/read-run-record";
import { destinationChoices } from "@/features/documentation/review/destination-resolution";
import { DestinationForm } from "@/features/documentation/components/runs/destination-form";
import { RunBreadcrumbs } from "@/features/documentation/components/runs/run-breadcrumbs";
async function Content({ params }: { params: Promise<{ id: string }> }) {
  const run = await readStoredDocumentationRun((await params).id).catch(() => null);
  if (!run || !("schemaVersion" in run.record) || !run.record.retainedProposal) notFound();
  const repository = `${run.record.input.owner}/${run.record.input.repo}`;
  const choices = await destinationChoices(run.record.retainedProposal.proposalId);
  return <AppShell repository={repository} active="Runs"><div className="max-w-2xl space-y-6">
    <RunBreadcrumbs repository={repository} runId={run.id} current="Documentation destinations" />
    <h1 className="text-2xl font-semibold">Documentation destinations</h1>
    <p className="text-sm leading-6 text-muted-foreground">These screens were verified from pinned routing source or observed application navigation. Runtime revision uncertainty still requires confirmation. When a workflow could belong to more than one screen, confirm its destination before publication. This changes delivery metadata, not generated wording or support checks.</p>
    {!choices.length && <p role="status" className="text-sm leading-6">No supported proposal with verified screen candidates is available. No application route will be invented. Routing evidence may be missing from this bounded scan, or this project may have no UI. The retained run details explain its coverage gaps.</p>}
    {choices.map(choice => <section key={choice.unitId} className="space-y-4 rounded-xl border bg-card p-5"><h2 className="font-semibold">{choice.title}</h2>{choice.options.some(option => option.confirmed) ? <p className="text-sm text-muted-foreground">Confirmed screen: {choice.options.find(option => option.confirmed)!.label}.</p> : choice.options.some(option => option.automatic) ? <><p className="text-sm text-muted-foreground">Assigned automatically: {choice.options.find(option => option.automatic)!.label}. No confirmation is required.</p><details><summary className="cursor-pointer text-sm text-muted-foreground">Correct destination</summary><div className="mt-4"><DestinationForm runId={run.id} expectedHash={choice.proposalHash} options={choice.options} /></div></details></> : <DestinationForm runId={run.id} expectedHash={choice.proposalHash} options={choice.options} />}<details><summary className="cursor-pointer text-sm text-muted-foreground">Route evidence</summary><ul className="mt-3 space-y-2 text-xs text-muted-foreground">{choice.options.map(option => <li key={option.id}>{option.label}: {option.evidence?.sources.map(source => `${source.path}:${source.line}`).join(", ")} · pinned {option.evidence?.commitId.slice(0, 7)}</li>)}</ul></details></section>)}
    {!!run.record.reviewReadiness?.actionableDecisionIds.length && <Link className="text-sm text-primary underline" href={`/docs?${new URLSearchParams({ repository, tab: "pending", proposal: run.record.retainedProposal.proposalId })}`}>Review pending changes</Link>}
  </div></AppShell>;
}
export default function Page(props: { params: Promise<{ id: string }> }) { return <Suspense fallback={<PageLoader />}><Content {...props} /></Suspense>; }
