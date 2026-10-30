import Link from "next/link";
import { Suspense } from "react";
import { getDocumentationRun } from "@/features/documentation/run-operations";
import { ProductChangeAnalysisResult } from "@/features/sources/components/product-change-analysis-result";
import { LoadingList } from "@/components/application/loading-list";
async function EvidenceContent({ params }: { params: Promise<{ id: string }> }) {
  const run = await getDocumentationRun((await params).id).catch(() => null);
  return <main className="mx-auto w-full max-w-4xl space-y-6 px-5 py-8 sm:px-8"><Link className="text-sm underline" href={run ? `/runs/${run.id}?${new URLSearchParams({ repository: `${run.record.input.owner}/${run.record.input.repo}`, ...(run.record.input.branch ? { branch: run.record.input.branch } : {}) })}` : "/runs"}>← Back to run</Link><h1 className="text-2xl font-semibold">Findings & evidence</h1><p className="text-sm text-muted-foreground">Inspect the Git patches and any selected source files supplied to this run. Coverage limitations and qualifications are preserved below.</p>{run?.record.analysis ? <ProductChangeAnalysisResult result={run.record.analysis} /> : <p role="status">No analysis evidence is available for this run.</p>}</main>;
}
export default function EvidencePage(props: { params: Promise<{ id: string }> }) { return <Suspense fallback={<LoadingList />}><EvidenceContent {...props} /></Suspense>; }
