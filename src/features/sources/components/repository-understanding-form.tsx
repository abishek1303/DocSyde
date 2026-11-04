"use client";
import { ArrowRight, GitBranch, LoaderCircle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { SetupStepper } from "@/components/application/setup-stepper";
import { Input } from "@/components/ui/input";
import { useState, useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { understandRepository } from "@/app/sources/understanding/actions";
import { Button } from "@/components/ui/button";

export function RepositoryUnderstandingForm({ repository, revision, exists, savedProductContext, branches = [], onCancel, onComplete }: {
 repository: string; revision: string; exists: boolean; savedProductContext: string; branches?: string[]; onCancel?: () => void; onComplete?: () => void;
}) {
 const [state, action, pending] = useActionState(understandRepository, {});
 const [productContext, setProductContext] = useState(savedProductContext);
 const [step, setStep] = useState(0);
 const [branch, setBranch] = useState(revision);
 const router = useRouter();
 const panel = useRef<HTMLDivElement>(null);
 useEffect(() => { panel.current?.focus(); }, [step]);
 useEffect(() => { if (state.success) { router.refresh(); onComplete?.(); } }, [state, router, onComplete]);
 const names = [...new Set([revision, ...branches].filter(Boolean))];
 return <form action={action} onSubmit={event => { if (step !== 2) { event.preventDefault(); if (branch.trim()) setStep(step + 1); } }} className="space-y-6 rounded-xl border bg-card p-5 sm:p-8">
  <input type="hidden" name="repository" value={repository} /><input type="hidden" name="revision" value={branch} />
  <SetupStepper step={step} />
  <div ref={panel} tabIndex={-1} className="min-w-0 space-y-6 outline-none">
    <div hidden={step !== 0} className="space-y-5"><div className="space-y-2"><h2 className="text-xl font-semibold">Select branch</h2><p className="text-sm leading-7 text-muted-foreground">Choose the branch DocSyde should explore to understand your product.</p></div>
      <label htmlFor="understanding-branch" className="sr-only">Branch</label>
      {branches.length ? <div className="relative"><GitBranch className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><select id="understanding-branch" value={branch} onChange={event => setBranch(event.target.value)} required disabled={pending} className="h-11 w-full rounded-lg border bg-background pl-10 pr-4 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">{names.map(name => <option key={name} value={name}>{name}</option>)}</select></div>
        : <Input id="understanding-branch" value={branch} onChange={event => setBranch(event.target.value)} required maxLength={1024} disabled={pending} />}
    </div>
    <div hidden={step !== 1} className="space-y-4"><div className="space-y-2"><h2 className="text-xl font-semibold">Add context</h2><p className="text-sm leading-7 text-muted-foreground">Help DocSyde understand who uses this product and what matters to them.</p></div>
      <label htmlFor="onboarding-product-context" className="block text-sm font-medium">Product context <span className="font-normal text-muted-foreground">(optional)</span></label>
      <Textarea id="onboarding-product-context" name="productContext" rows={5} maxLength={500} value={productContext} disabled={pending} onChange={event => setProductContext(event.target.value)} placeholder="Who uses this product, and why?" /><p className="text-right text-xs text-muted-foreground">{productContext.length}/500</p>
    </div>
    {step === 2 && <div className="space-y-5"><div className="space-y-2"><h2 className="text-xl font-semibold">Review &amp; start</h2><p className="text-sm leading-7 text-muted-foreground">DocSyde will read selected source files and save product understanding for future documentation runs.</p></div>
      <dl className="space-y-4 rounded-lg bg-muted/50 p-5 text-sm"><div><dt className="text-muted-foreground">Repository</dt><dd className="mt-1 break-words font-medium">{repository}</dd></div><div><dt className="text-muted-foreground">Branch</dt><dd className="mt-1 font-medium">{branch}</dd></div><div><dt className="text-muted-foreground">Product context</dt><dd className="mt-1 whitespace-pre-wrap leading-6">{productContext || "No additional context"}</dd></div></dl>
      {exists && <p className="text-xs leading-6 text-muted-foreground">Your current understanding stays available if this scan fails.</p>}
    </div>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5"><div className="flex gap-2">{onCancel && <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>}{step > 0 && <Button type="button" variant="outline" disabled={pending} onClick={() => setStep(step - 1)}>Back</Button>}</div>
      {step < 2 ? <Button key="next" type="button" disabled={!branch.trim() || pending} onClick={() => setStep(step + 1)}>Continue<ArrowRight aria-hidden="true" /></Button>
        : <Button key="start" type="submit" disabled={pending} aria-busy={pending}>{pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}{pending ? "Analyzing repository…" : exists ? "Rescan repository" : "Analyze repository"}</Button>}
    </div>
    {pending && <p role="status" className="text-sm text-muted-foreground">Reading source files and building product understanding…</p>}
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
  </div>
 </form>;
}
