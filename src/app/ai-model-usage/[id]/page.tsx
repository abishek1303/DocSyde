import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AppShell } from "@/components/application/shell";
import { LoadingList } from "@/components/application/loading-list";
import { getModelUsage } from "@/features/documentation/runs/model-usage-operations";

async function DetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const invocation = await getModelUsage(id).catch(() => undefined);
  if (invocation === null) notFound();
  if (!invocation) return <AppShell repository="Logs unavailable" active="Logs" showBranch={false}><h1 className="text-3xl font-semibold">Model invocation details</h1><p role="alert">Invocation details are unavailable. Check repository access and PostgreSQL, then reload.</p><Link href="/ai-model-usage" className="underline">Back to AI model usage log</Link></AppShell>;
  const query = new URLSearchParams({ repository: invocation.repository });
  const values = [
    ["Invocation ID", invocation.id], ["Run ID", invocation.runId], ["Created", new Date(invocation.createdAt).toISOString()],
    ["Stage", invocation.stage], ["Operation", invocation.operation], ["Provider", invocation.provider], ["Model", invocation.model],
    ["Status", invocation.status], ["Failure kind", invocation.failureKind], ["Completion reason", invocation.completionReason],
    ["Input tokens", invocation.inputTokens], ["Output tokens", invocation.outputTokens],
    ["Latency", invocation.elapsedMs === null ? null : `${invocation.elapsedMs} ms`],
  ];
  return <AppShell repository={invocation.repository} active="Logs" showBranch={false}>
    <header className="space-y-3"><Link href={`/ai-model-usage?${query}`} className="text-sm text-primary underline underline-offset-4">AI model usage log</Link><h1 className="text-3xl font-semibold tracking-tight">Model invocation details</h1></header>
    <dl className="grid gap-x-8 gap-y-5 rounded-xl border bg-card p-6 sm:grid-cols-2 lg:grid-cols-3">{values.map(([label, value]) => <div key={String(label)} className="min-w-0"><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1 break-words text-sm">{value ?? "Unavailable"}</dd></div>)}</dl>
    <section className="space-y-4 rounded-xl border bg-card p-6"><h2 className="font-semibold">Sanitized diagnostics</h2>{invocation.diagnostic ? <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6">{JSON.stringify(invocation.diagnostic, null, 2)}</pre> : <p className="text-sm text-muted-foreground">No diagnostic retained.</p>}</section>
    <Link href={`/runs/${invocation.runId}?${query}`} className="text-sm text-primary underline underline-offset-4">Open run</Link>
  </AppShell>;
}
export default function DetailPage(props: { params: Promise<{ id: string }> }) { return <Suspense fallback={<LoadingList />}><DetailContent {...props} /></Suspense>; }
