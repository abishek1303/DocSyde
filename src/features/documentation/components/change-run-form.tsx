"use client";
import { useActionState } from "react";
import { startRun } from "@/app/runs/actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ProductContextInputs } from "./product-context-inputs";
export function ChangeRunForm({ owner, repo, head, base, branch }: { owner: string; repo: string; head: string; base: string | null; branch?: string }) {
  const [state, action, pending] = useActionState(startRun, {});
  return <form action={action} className="space-y-6 rounded-xl border bg-card p-5 sm:p-6">
    <input type="hidden" name="owner" value={owner} /><input type="hidden" name="repo" value={repo} /><input type="hidden" name="head" value={head} /><input type="hidden" name="branch" value={branch ?? ""} />
    <div><h2 className="text-xl font-semibold">Run DocSyde</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Analyze product impact and propose grounded documentation. Review and save the draft separately.</p></div>
    <ProductContextInputs owner={owner} repo={repo} compact />
    <details className="rounded-lg border p-4"><summary className="cursor-pointer font-medium">Advanced options</summary><div className="mt-4 space-y-4"><div><label htmlFor="run-base" className="mb-2 block text-sm font-medium">Base revision</label><Input id="run-base" name="base" defaultValue={base ?? ""} required disabled={!base} maxLength={1024} /><p className="mt-2 text-xs text-muted-foreground">Base must be an ancestor of the selected commit. Revisions are pinned when you start.</p></div><div><label htmlFor="run-paths" className="mb-2 block text-sm font-medium">Additional source paths</label><Textarea id="run-paths" name="paths" maxLength={10240} placeholder="Optional, one repository-relative path per line (maximum 10)" /></div><div><label htmlFor="run-associations" className="mb-2 block text-sm font-medium">Association catalog (JSON)</label><Textarea id="run-associations" name="associations" maxLength={10000} placeholder="[]" /></div></div></details>
    {!base && <p role="status" className="text-sm text-muted-foreground">This commit has no parent. The current workflow requires an ancestor comparison; choose a later commit.</p>}
    <Button type="submit" disabled={pending || !base}>{pending ? "Preparing run…" : "Start analysis & propose documentation"}</Button>
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
  </form>;
}
