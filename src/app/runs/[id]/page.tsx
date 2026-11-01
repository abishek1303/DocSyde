import { RunBreadcrumbs } from "@/features/documentation/components/run-breadcrumbs";
import { AppShell } from "@/components/application/shell";
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
  return <AppShell repository={run ? `${run.record.input.owner}/${run.record.input.repo}` : "Run unavailable"} branch={run?.record.input.branch} active="Runs">
    <RunBreadcrumbs repository={run ? `${run.record.input.owner}/${run.record.input.repo}` : undefined} branch={run?.record.input.branch} runId={run?.id} current="Run" comparison />{run ? <RunMonitor initial={runView(run)} /> : <p role="alert">Run unavailable. Check PostgreSQL migrations and repository access, then reload.</p>}</AppShell>;
}
export default function RunPage(props: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<LoadingList />}>
    <RunContent {...props} />
  </Suspense>;
}
