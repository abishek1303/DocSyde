"use client";

import { useActionState, useState } from "react";
import { startBranchRun } from "@/app/runs/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function BranchRunForm({ repository, branches, selected, latestChanges, selectionUnavailable = false }: {
  repository: string; branches: string[]; selected?: string | null; latestChanges: { branch: string; title: string }[]; selectionUnavailable?: boolean;
}) {
  const [branch, setBranch] = useState(selected ?? "");
  const latestChange = latestChanges.find(change => change.branch === branch)?.title.replace(/^(?:feat|fix|docs|refactor|chore|perf|test|build|ci|style|revert)(?:\([^)]*\))?!?:\s*/i, "");
  const [state, action, pending] = useActionState(startBranchRun, {});
  const names = [...new Set([...(selected ? [selected] : []), ...branches])];
  return <form action={action} className="max-w-2xl space-y-6 rounded-xl border bg-card p-6">
    <input type="hidden" name="repository" value={repository} />
    <div className="space-y-2">
      <label htmlFor="run-branch" className="block text-sm font-medium">Branch</label>
      {names.length && !selectionUnavailable ? <select id="run-branch" name="branch" value={branch} onChange={event => setBranch(event.target.value)} required disabled={pending} className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring">
        <option value="" disabled>Choose a branch</option>{names.map(name => <option key={name} value={name}>{name}</option>)}</select> : <Input id="run-branch" name="branch" value={branch} onChange={event => setBranch(event.target.value)} maxLength={1024} required disabled={pending} placeholder="Branch name" />}
      <div className="pt-1" aria-live="polite">
        <p className="text-xs text-muted-foreground">Latest change</p>
        <p className="mt-1 line-clamp-2 text-sm leading-6">{latestChange || "No change summary is available for this branch."}</p>
      </div>
      {selectionUnavailable && <p role="status" className="text-xs text-muted-foreground">Automatic selection is unavailable. Enter a branch name.</p>}
    </div>
    <div className="space-y-2">
      <label htmlFor="run-context" className="block text-sm font-medium">Context</label>
      <Textarea id="run-context" name="runContext" rows={5} maxLength={300} disabled={pending} placeholder="Anything we should know about this product or change?" />
    </div>
    <Button type="submit" disabled={pending}>{pending ? "Starting run…" : "Start run"}</Button>
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
  </form>;
}
