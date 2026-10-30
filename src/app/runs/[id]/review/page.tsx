import Link from "next/link";
import { Suspense } from "react";
import { getDocumentationRun } from "@/features/documentation/run-operations";
import { SaveDraftForm } from "@/features/documentation/components/save-draft-form";
import { DraftInspector } from "@/features/documentation/components/draft-inspector";
import { LoadingList } from "@/components/application/loading-list";
async function ReviewContent({ params }: { params: Promise<{ id: string }> }) {
  const run = await getDocumentationRun((await params).id).catch(() => null);
  const document = run?.record.result?.document;
  const result = run?.record.result;
  return <main className="mx-auto w-full max-w-4xl space-y-6 px-5 py-8 sm:px-8"><nav aria-label="Review navigation" className="flex flex-wrap gap-4 text-sm underline"><Link href={run ? `/runs/${run.id}?${new URLSearchParams({ repository: `${run.record.input.owner}/${run.record.input.repo}`, ...(run.record.input.branch ? { branch: run.record.input.branch } : {}) })}` : "/runs"}>← Back to run</Link>{run?.record.analysis && <Link href={`/runs/${run.id}/evidence?${new URLSearchParams({ repository: `${run.record.input.owner}/${run.record.input.repo}` })}`}>View findings & evidence</Link>}</nav><header className="space-y-2"><h1 className="text-2xl font-semibold">Review proposed documentation</h1><p className="text-sm text-muted-foreground">Nothing is published. Review the proposed sections, assumptions and source evidence before saving.</p></header>{document && result ? <><details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">Proposed sections ({document.sections.length})</summary><ul className="mt-3 space-y-2">{document.sections.map(section => <li key={section.id}><a className="text-sm underline" href={`#section-${section.id}`}>{section.title}</a></li>)}</ul></details>{result.saveUnavailable && <p role="status" className="text-sm text-muted-foreground">{result.saveUnavailable}</p>}{result.preview ? <SaveDraftForm document={document} preview={result.preview} savedAt={run?.savedAt} /> : <DraftInspector document={document} />}</> : <p role="status">No draft is available for review. Open the run to inspect its status or outcome.</p>}</main>;
}
export default function ReviewPage(props: { params: Promise<{ id: string }> }) { return <Suspense fallback={<LoadingList />}><ReviewContent {...props} /></Suspense>; }
