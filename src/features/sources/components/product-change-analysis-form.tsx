"use client";
import { useActionState } from "react";
import { runProductAnalysis } from "@/app/sources/analysis/actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { ProductState } from "../product-change-analysis";
import { ProductChangeAnalysisResult } from "./product-change-analysis-result";
export function ProductChangeAnalysisForm() {
  const [state, action, pending] = useActionState<ProductState, FormData>(runProductAnalysis, {});
  return <div className="space-y-6"><form action={action} className="space-y-4 rounded-lg border p-4"><div className="grid gap-4 sm:grid-cols-2">{[
    ["owner", "Owner", "abishek1303"], ["repo", "Repository", "DocSyde"], ["base", "Base revision", "cb08108"], ["head", "Head revision", "e321954"],
  ].map(([name, label, value]) => <div key={name}><label htmlFor={`product-${name}`} className="mb-1 block">{label}</label><Input id={`product-${name}`} name={name} defaultValue={value} required maxLength={1024} /></div>)}</div>
  <label htmlFor="product-paths" className="block">Context paths (optional, one per line, maximum ten)</label><Textarea id="product-paths" name="paths" rows={4} maxLength={10240} defaultValue={"src/app/sources/context/page.tsx\nsrc/features/sources/components/source-context-form.tsx"} />
  <p className="text-sm text-muted-foreground">Selected evidence is sent to the hosted model. No persistence. Large bundles require a smaller selection.</p><Button disabled={pending} type="submit">{pending ? "Analyzing…" : "Analyze product changes"}</Button><p role="status" aria-live="polite">{pending ? "Retrieving evidence and interpreting product changes…" : ""}</p>{state.error && <p role="alert" className="text-destructive">{state.error}</p>}</form>
  {!state.result && !pending && <p>Run an analysis to inspect product meaning and uncertainty.</p>}{state.result && !pending && <ProductChangeAnalysisResult result={state.result} />}</div>;
}
