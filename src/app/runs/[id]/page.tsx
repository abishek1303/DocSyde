import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDocumentationRun, runView } from "@/features/documentation/run-operations";
import { RunMonitor } from "@/features/documentation/components/run-monitor";
import { LoadingList } from "@/components/application/loading-list";
async function RunContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const run = await getDocumentationRun(id).catch(() => undefined);
  if (run === null) notFound();
  return <main className="mx-auto w-full max-w-4xl space-y-6 px-5 py-8 sm:px-8"><Link href={run ? `/runs?${new URLSearchParams({ repository: `${run.record.input.owner}/${run.record.input.repo}` })}` : "/runs"} className="text-sm text-muted-foreground underline">← Runs</Link>{run ? <RunMonitor initial={runView(run)} /> : <p role="alert">Run unavailable. Check PostgreSQL migrations and repository access, then reload.</p>}</main>;
}
export default function RunPage(props: { params: Promise<{ id: string }> }) { return <Suspense fallback={<LoadingList />}><RunContent {...props} /></Suspense>; }
