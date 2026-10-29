"use client";
import { useActionState } from "react";
import { runDraft } from "@/app/documentation/draft/actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { DraftInspector } from "./draft-inspector";
export function DraftForm() {
  const [result, action, pending] = useActionState(runDraft, null);
  return <div className="space-y-6"><form action={action} className="space-y-4 rounded border p-4"><div className="grid gap-4 sm:grid-cols-2">{[["owner", "Owner", "abishek1303"], ["repo", "Repository", "DocSyde"], ["base", "Base revision", "cb08108"], ["head", "Head revision", "e321954"]].map(([name, label, value]) => <div key={name}><label htmlFor={`draft-${name}`}>{label}</label><Input id={`draft-${name}`} name={name} required defaultValue={value} maxLength={1024} /></div>)}</div>
    <label htmlFor="draft-paths" className="block">Selected context paths (one per line)</label><Textarea id="draft-paths" name="paths" maxLength={10240} defaultValue={"src/app/sources/context/page.tsx\nsrc/features/sources/components/source-context-form.tsx"} />
    <label htmlFor="draft-context" className="block">Optional association catalog (JSON)</label><Textarea id="draft-context" name="context" maxLength={10000} defaultValue={'[{"id":"route-context","kind":"route","value":"/sources/context","origin":"operator"}]'} /><p className="text-sm text-muted-foreground">Allowed kinds: route, feature, workflow, ui-surface, audience. Labels supply context, not proof of behavior. Fresh runs make one analysis call and one draft call; selected evidence is sent to the hosted model. No data is saved.</p>
    <Button type="submit" disabled={pending}>{pending ? "Preparing draft…" : "Analyze and propose draft"}</Button><p role="status" aria-live="polite">{pending ? "Analyzing source changes, then generating a grounded draft…" : ""}</p></form>
    {!result && !pending && <p>Run the workflow to inspect a proposed structured draft.</p>}{result && !pending && <><p role={result.status === "error" ? "alert" : "status"}>{result.status}: {result.reason}</p>{result.analysisRejection && <details><summary className="cursor-pointer">Upstream analysis rejection</summary><pre className="text-xs">{JSON.stringify(result.analysisRejection, null, 2)}</pre></details>}{result.document && <DraftInspector document={result.document} />}{result.input && <details><summary className="cursor-pointer">Supplied facts, findings, associations and provenance</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(result.input, null, 2)}</pre></details>}</>}
  </div>;
}
