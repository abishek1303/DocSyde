"use client";

import { useActionState, useState } from "react";
import { startFullScan, startBranchRun } from "@/app/runs/actions";
import { SetupStepper } from "@/components/application/setup-stepper";
import { MotionReveal } from "@/components/application/motion-reveal";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function BranchRunForm({ repository, branches, selected, latestChanges, selectionUnavailable = false, fullScan = false }: {
  fullScan?: boolean; repository: string; branches: string[]; selected?: string | null; latestChanges: { branch: string; title: string }[]; selectionUnavailable?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [context, setContext] = useState("");
  const [branch, setBranch] = useState(selected ?? "");
  const latestChange = latestChanges.find(change => change.branch === branch)?.title.replace(/^(?:feat|fix|docs|refactor|chore|perf|test|build|ci|style|revert)(?:\([^)]*\))?!?:\s*/i, "");
  const [state, action, pending] = useActionState(fullScan ? startFullScan : startBranchRun, {});
  const names = [...new Set([...(selected ? [selected] : []), ...branches])];
  return <form action={action} onSubmit={event => { if (step !== 2) { event.preventDefault(); if (branch.trim()) setStep(step + 1); } }} className="max-w-2xl space-y-6 rounded-xl border bg-card p-6">
    <input type="hidden" name="repository" value={repository} />
    <SetupStepper step={step} />
    <div hidden={step !== 0} className="space-y-2">
      <label htmlFor="run-branch" className="block text-sm font-medium">Branch</label>
      {names.length && !selectionUnavailable ? <select id="run-branch" name="branch" value={branch} onChange={event => setBranch(event.target.value)} required disabled={pending} className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring">
        <option value="" disabled>Choose a branch</option>{names.map(name => <option key={name} value={name}>{name}</option>)}</select> : <Input id="run-branch" name="branch" value={branch} onChange={event => setBranch(event.target.value)} maxLength={1024} required disabled={pending} placeholder="Branch name" />}
      {!fullScan && <div className="pt-1" aria-live="polite">
        <p className="text-xs text-muted-foreground">Latest change</p>
        <MotionReveal key={branch}><p className="mt-1 line-clamp-2 text-sm leading-6">{latestChange || "No change summary is available for this branch."}</p></MotionReveal>
      </div>}
      {selectionUnavailable && <p role="status" className="text-xs text-muted-foreground">Automatic selection is unavailable. Enter a branch name.</p>}
    </div>
    <div hidden={step !== 1} className="space-y-2">
      <label htmlFor="run-context" className="block text-sm font-medium">{fullScan ? "Product context (optional)" : "Change context (optional)"}</label>
      <Textarea id="run-context" name="runContext" value={context} onChange={event => setContext(event.target.value)} rows={5} maxLength={300} disabled={pending} placeholder={fullScan ? "Which product workflows should the documentation explain?" : "What is the intent of this change?"} />
    </div>
    {step === 2 && <div className="space-y-5 rounded-lg bg-muted/50 p-5"><h2 className="text-lg font-semibold">Ready to {fullScan ? "generate documentation" : "analyze changes"}</h2><dl className="space-y-4 text-sm"><div><dt className="text-muted-foreground">Repository</dt><dd className="mt-1 break-words font-medium">{repository}</dd></div><div><dt className="text-muted-foreground">Branch</dt><dd className="mt-1 font-medium">{branch}</dd></div><div><dt className="text-muted-foreground">Context</dt><dd className="mt-1 whitespace-pre-wrap">{context || "No additional context"}</dd></div></dl><p className="text-xs leading-6 text-muted-foreground">You’ll review proposed documentation changes before publishing.</p></div>}
    <div className="flex items-center justify-between border-t pt-5">
      <Button type="button" variant="ghost" disabled={step === 0 || pending} onClick={() => setStep(step - 1)}>Back</Button>
      {step < 2 ? <Button key="next" type="button" disabled={!branch.trim()} onClick={() => setStep(step + 1)}>Continue</Button> : <Button key="start" type="submit" disabled={pending} aria-busy={pending}>{pending && <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />}{pending ? "Starting run…" : fullScan ? "Generate documentation" : "Start run"}</Button>}
    </div>
    {state.error && <MotionReveal key={state.error}><p role="alert" className="text-sm text-destructive">{state.error}</p></MotionReveal>}
  </form>;
}
