"use client";
import { useActionState } from "react";
import { analyzeChanges } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AnalysisState, GeneratedSummary } from "../change-summary";

export function ChangeAnalysisForm() {
  const [state, action, pending] = useActionState<AnalysisState, FormData>(analyzeChanges, {});
  const result = state.result;
  function claims(items: GeneratedSummary["observations"]) {
    return items.length ? <ul className="space-y-4">{items.map((claim, i) => <li key={i}>
      <p>{claim.text}</p>{"uncertainty" in claim && <p className="text-muted-foreground">Uncertainty: {String(claim.uncertainty)}</p>}
      {claim.citations.map((citation, j) => <details className="mt-2 rounded border p-2" key={j}><summary className="cursor-pointer">Evidence: {result?.files.find(f => f.id === citation.fileId)?.path}</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">{citation.excerpt}</pre><a className="underline" href={`#${citation.fileId}`}>Inspect file evidence</a></details>)}
    </li>)}</ul> : <p className="text-muted-foreground">None established by the supplied evidence.</p>;
  }
  return <div className="space-y-6">
    <Card><CardHeader><CardTitle>Compare GitHub revisions</CardTitle></CardHeader><CardContent>
      <form action={action} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">{[
          ["owner", "Repository owner", "abishek1303"], ["repo", "Repository name", "DocSyde"],
          ["base", "Base revision", "40bd71f8adb0a8380f0de20ff65aa6915fb7654c"], ["head", "Head revision", "78695f525dce698832c9ef9dbdb4109dd86fdd9c"],
        ].map(([name, label, value]) => <div key={name}><label htmlFor={name} className="mb-1 block text-sm font-medium">{label}</label><Input id={name} name={name} defaultValue={value} required maxLength={name === "base" || name === "head" ? 1024 : 100} aria-invalid={!!state.fieldErrors?.[name]} aria-describedby={`${name}-error`} /><p id={`${name}-error`} className="text-sm text-destructive">{state.fieldErrors?.[name]?.join(" ")}</p></div>)}</div>
        <p className="text-sm text-muted-foreground">Use branches, tags, or commit hashes; base must be an ancestor of head. Selected source patches are sent to the configured hosted model.</p>
        <Button type="submit" disabled={pending}>{pending ? "Analyzing…" : "Analyze changes"}</Button>
        <p role="status" aria-live="polite">{pending ? "Comparing revisions and analyzing evidence…" : ""}</p>
        {state.error && <p role="alert" className="text-destructive">{state.error}</p>}
      </form>
    </CardContent></Card>
    {!result && !pending && <p className="text-muted-foreground">Run a comparison to inspect source changes and possible effects.</p>}
    {result && !pending && <section aria-label="Analysis result" className="space-y-5">
      <h2 className="text-xl font-semibold">Source change summary</h2>
      <p className="break-all text-sm">{result.repository}<br/>Pinned comparison: {result.base} → {result.head}</p>
      <Badge variant={result.limited ? "destructive" : "secondary"}>{result.limited ? "Limited evidence" : "Supplied patches only"}</Badge>
      <p>{result.files.length} changed files · {result.commits} commits · {result.files.filter(f => f.coverage === "included").length} nonempty patches included · {result.bytes} evidence bytes</p>
      <p className="text-sm text-muted-foreground">{result.notice}</p>
      {result.error && <p role="alert" className="text-destructive">{result.error}</p>}
      {result.summary && <><Card><CardHeader><CardTitle>Observed source changes</CardTitle></CardHeader><CardContent>{claims(result.summary.observations)}</CardContent></Card>
      <Card><CardHeader><CardTitle>Possible user-facing effects</CardTitle></CardHeader><CardContent>{claims(result.summary.effects)}</CardContent></Card>
      <div><h3 className="font-semibold">Uncertainty and missing context</h3><ul className="list-inside list-disc">{result.summary.unknowns.map((text, i) => <li key={i}>{text}</li>)}</ul><p className="text-sm text-muted-foreground">Citation matching establishes traceability, not semantic accuracy. Model: {result.model} · {result.elapsedMs} ms</p></div></>}
      <h3 className="font-semibold">Evidence inventory</h3>
      {result.files.map(file => <details id={file.id} key={file.id} className="rounded-lg border p-3"><summary className="cursor-pointer break-all">{file.path} · {file.kind} · +{file.additions}/−{file.deletions} · {file.coverage}</summary><p className="my-2 text-sm">{file.coverage === "over-budget" ? "Entire patch excluded: exceeds 12 KiB." : file.coverage === "unavailable" ? "GitHub supplied no patch; this does not establish binary content." : file.coverage === "empty" ? "GitHub supplied an empty patch." : "Patch as supplied by GitHub; completeness is not guaranteed."}</p><a className="underline" href={file.url}>Pinned file</a>{file.previousUrl && <> · <a className="underline" href={file.previousUrl}>Previous path at base</a></>}<pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs">{file.patch}</pre></details>)}
    </section>}
  </div>;
}
