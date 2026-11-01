import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { AppShell } from "@/components/application/shell";
import { LoadingList } from "@/components/application/loading-list";
import { getModelFailure } from "@/features/documentation/runs/model-usage-operations";
import { runFailureDescription } from "@/features/documentation/runs/run-failure";

async function FailureContent({ params }: { params: Promise<{ id: string; stage: string }> }) {
  const { id, stage } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const details = await getModelFailure(id, stage).catch(() => undefined);
  if (details === null) notFound();
  if (!details) return <AppShell repository="Logs unavailable" active="Logs" showBranch={false}><h1 className="text-3xl font-semibold">Model failure details</h1><p role="alert">Failure details are unavailable. Check repository access and PostgreSQL, then reload.</p></AppShell>;
  const query = new URLSearchParams({ repository: details.repository });
  if (details.invocationId) redirect(`/ai-model-usage/${details.invocationId}?${query}`);
  const description = details.failure ? runFailureDescription(details.failure.code) : null;
  return <AppShell repository={details.repository} active="Logs" showBranch={false}>
    <h1 className="text-3xl font-semibold tracking-tight">Model failure details</h1>
    <section className="space-y-4 rounded-xl border bg-card p-6"><h2 className="font-semibold">{details.stage}</h2><p className="text-sm text-muted-foreground">{details.logsUnavailable ? "Invocation logs are unavailable. Saved failure details are shown below." : "No invocation log was retained for this failure."}</p>
      {description && <><p>{description.message}</p><p className="text-sm text-muted-foreground">{description.nextStep}</p></>}
      {details.failure?.diagnostic && <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6">{JSON.stringify(details.failure.diagnostic, null, 2)}</pre>}
    </section>
    <div className="flex flex-wrap gap-4 text-sm"><Link href={`/ai-model-usage?${query}&runId=${id}&stage=${encodeURIComponent(stage)}`} className="text-primary underline underline-offset-4">AI model usage log</Link><Link href={`/runs/${id}?${query}`} className="underline underline-offset-4">Back to run</Link></div>
  </AppShell>;
}
export default function FailurePage(props: { params: Promise<{ id: string; stage: string }> }) { return <Suspense fallback={<LoadingList />}><FailureContent {...props} /></Suspense>; }
