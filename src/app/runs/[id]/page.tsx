import { AppShell } from "@/components/application/shell";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getDocumentationRun, runView } from "@/features/documentation/runs/run-operations";
import { RunMonitor } from "@/features/documentation/components/runs/run-monitor";
import { LoadingList } from "@/components/application/loading-list";
async function RunContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const run = await getDocumentationRun(id).catch(() => undefined);
  if (run === null) notFound();
  return <AppShell repository={run ? `${run.record.input.owner}/${run.record.input.repo}` : "Run unavailable"} branch={run?.record.input.branch} active="Runs" contentLayout="workspace">
    {run ? <div className="mx-auto flex h-full min-h-0 max-w-screen-2xl flex-col px-5 py-5 sm:px-8"><RunMonitor initial={runView(run)} /></div> : <p role="alert">Run unavailable. Check PostgreSQL migrations and repository access, then reload.</p>}</AppShell>;
}
export default function RunPage(props: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<LoadingList />}>
    <RunContent {...props} />
  </Suspense>;
}
