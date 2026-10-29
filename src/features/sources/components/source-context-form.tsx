"use client";
import { useActionState } from "react";
import { loadSourceContext } from "@/app/sources/context/actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ContextState } from "../source-context";
export function SourceContextForm() {
  const [state, action, pending] = useActionState<ContextState, FormData>(loadSourceContext, {});
  const result = state.result;
  return <div className="space-y-6">
    <Card><CardContent><form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">{[
        ["owner", "Repository owner", "abishek1303"], ["repo", "Repository name", "DocSyde"],
        ["revision", "Branch, tag, or commit", "cb08108"],
      ].map(([name, label, value]) => <div key={name}><label className="mb-1 block text-sm font-medium" htmlFor={`context-${name}`}>{label}</label><Input id={`context-${name}`} name={name} defaultValue={value} required maxLength={name === "revision" ? 1024 : 100} aria-invalid={!!state.fieldErrors?.[name]} aria-describedby={`context-${name}-error`} /><p id={`context-${name}-error`} className="text-sm text-destructive">{state.fieldErrors?.[name]?.join(" ")}</p></div>)}</div>
      <label className="block text-sm font-medium" htmlFor="context-paths">File paths, one per line</label>
      <Textarea id="context-paths" name="paths" required rows={5} maxLength={10240} defaultValue={"src/features/sources/change-summary.ts\nsrc/features/sources/summarize-changes.ts\nsrc/features/sources/summary-evidence.ts\nsrc/app/actions.ts"} aria-invalid={!!state.fieldErrors?.paths} aria-describedby="context-paths-help context-paths-error" />
      <p id="context-paths-error" className="text-sm text-destructive">{state.fieldErrors?.paths?.join(" ")}</p>
      <p id="context-paths-help" className="text-sm text-muted-foreground">Up to 10 unique relative paths. Review limits: 64 KiB per file, 256 KiB total. No model calls or data storage.</p>
      <Button disabled={pending} type="submit">{pending ? "Loading…" : "Load source context"}</Button>
      <p role="status" aria-live="polite">{pending ? "Resolving revision and retrieving selected files…" : ""}</p>
      {state.error && <p role="alert" className="text-destructive">{state.error}</p>}
    </form></CardContent></Card>
    {!result && !pending && <p className="text-muted-foreground">Load files to inspect their contents and evidence coverage.</p>}
    {result && !pending && <section aria-label="Source context result" className="space-y-4">
      <h2 className="text-xl font-semibold">Source context</h2>
      <p className="break-all text-sm">{result.repository}<br/>Requested revision: {result.requestedRevision}<br/>Pinned commit: {result.commitId}</p>
      <Badge variant={result.complete ? "secondary" : "destructive"}>{result.complete ? "All selected files available" : "Limited source context"}</Badge>
      <p>{result.files.length} requested · {result.available} available · {result.unavailable} unavailable or failed · {result.excluded} excluded · {result.bytes} selected text bytes</p>
      <p className="text-sm text-muted-foreground">Coverage applies only to your selected files. Other source dependencies and runtime behavior have not been inspected. Results are tied to the request shown above; load again to review changed inputs.</p>
      {result.error && <p role="alert" className="text-destructive">{result.error}</p>}
      {result.budgetExceeded && <p role="alert">Context exceeds 256 KiB. Select fewer or smaller files.</p>}
      {result.files.map(file => <details key={file.path} className="rounded-lg border p-3"><summary className="cursor-pointer break-all">{file.path} · {file.status}{file.size !== null ? ` · ${file.size} bytes` : ""}</summary>
        <p className="my-2 break-all text-xs">Content ID: {file.contentId ?? "unavailable"}</p><a href={file.url} className="underline">Pinned file on GitHub</a>
        {file.status === "available" ? file.text === "" ? <p className="mt-2">Available empty file.</p> : <pre className="mt-3 overflow-auto text-xs"><code>{file.text.split("\n").map((line, index) => <span className="block" key={index}><span aria-hidden="true" className="mr-4 inline-block w-10 select-none text-right text-muted-foreground">{index + 1}</span>{line || "\u00a0"}</span>)}</code></pre> : <p className="mt-2">{file.reason}</p>}
      </details>)}
    </section>}
  </div>;
}
