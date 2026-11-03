import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/application/shell";
import { selectedRepository, defaultBranch } from "@/features/sources/repository/repository-overview";
import { getRepositoryContext } from "@/features/sources/context/repository-context";
import { getUnderstanding } from "@/features/sources/context/understanding-operations";
import { RepositoryUnderstandingForm } from "@/features/sources/components/repository-understanding-form";
async function Understanding({ searchParams }: { searchParams: Promise<{ repository?: string; branch?: string }> }) {
 const selected = selectedRepository(await searchParams);
 const saved = await getUnderstanding(selected.name);
 const productContext = await getRepositoryContext(selected);
 const revision = selected.branch ?? await defaultBranch(selected);
 return <AppShell repository={selected.name} active="Overview"><div className="max-w-3xl space-y-6">
  <h1 className="text-3xl font-semibold">Understand this product</h1>
  <p className="text-muted-foreground">DocSyde learns product context from a small set of conventional repository files. Saved understanding guides future change analysis.</p>
  <RepositoryUnderstandingForm repository={selected.name} revision={revision} exists={Boolean(saved)} savedProductContext={productContext ?? ""} />
  {saved && <section className="space-y-4 rounded-xl border p-6">
   <h2 className="text-xl font-medium">What DocSyde learned</h2><p className="text-sm text-muted-foreground">{saved.generationContext ? saved.generationContext.productContextUsed ? "Analyzed with optional advisory product context." : "Repository-only analysis; no product context supplied." : "Historical analysis; context usage was not recorded."}</p><p>Analyzed revision <code>{saved.sha}</code> · {saved.analyzedAt}</p>
   <h3>Product purpose</h3><p>{saved.summary.purpose}</p><h3>Primary audience</h3><p>{saved.summary.audience}</p>
   {(["terminology", "workflows", "surfaces", "gaps"] as const).map(key => <div key={key}><h3 className="capitalize font-medium">{key}</h3><ul className="list-disc pl-5">{saved.summary[key].map((text, i) => <li key={i}>{text}</li>)}</ul></div>)}
   <h3>Files inspected</h3><ul>{saved.files.map(file => <li key={file.path}><code>{file.path}</code> · SHA256 {file.sha256.slice(0, 12)}</li>)}</ul>
   <p className="text-sm text-muted-foreground">Advisory context only. Source changes and runtime evidence are verified independently.</p>
  </section>}
  <Link className="underline" href={`/runs/new?${new URLSearchParams({ repository: selected.name, branch: revision })}`}>Analyze a change →</Link>
 </div></AppShell>;
}
export default function Page(props: { searchParams: Promise<{ repository?: string; branch?: string }> }) { return <Suspense fallback={<p>Loading repository understanding…</p>}><Understanding {...props} /></Suspense>; }
