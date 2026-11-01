import { RunBreadcrumbs } from "@/features/documentation/components/run-breadcrumbs";
import { AppShell } from "@/components/application/shell";
import { Suspense } from "react";
import { getDocumentationRun } from "@/features/documentation/run-operations";
import { ProductChangeAnalysisResult } from "@/features/sources/components/product-change-analysis-result";
import { LoadingList } from "@/components/application/loading-list";
async function EvidenceContent({ params }: { params: Promise<{ id: string }> }) {
  const run = await getDocumentationRun((await params).id).catch(() => null);
  return <AppShell repository={run ? `${run.record.input.owner}/${run.record.input.repo}` : "Run unavailable"} branch={run?.record.input.branch} active="Runs">
    <RunBreadcrumbs repository={run ? `${run.record.input.owner}/${run.record.input.repo}` : undefined} branch={run?.record.input.branch} runId={run?.id} current="Findings & evidence" />
    <h1 className="text-2xl font-semibold">Findings & evidence</h1>
    <p className="text-sm text-muted-foreground">Inspect the Git patches and any selected source files supplied to this run. Coverage limitations and qualifications are preserved below.</p>{run?.record.analysis ? <ProductChangeAnalysisResult result={run.record.analysis} /> : <p role="status">No analysis evidence is available for this run.</p>}</AppShell>;
}
export default function EvidencePage(props: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<LoadingList />}>
    <EvidenceContent {...props} />
  </Suspense>;
}
