"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, LoaderCircle, XCircle, SkipForward } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RUN_STEPS } from "../run-progress";
import type { RunView } from "../run-record";
import { RetryRunForm } from "./retry-run-form";

export function RunMonitor({ initial }: { initial: RunView }) {
  const [run, setRun] = useState(initial);
  const [executionError, setExecutionError] = useState("");
  const [message, setMessage] = useState("");
  const [clock, setClock] = useState<number | null>(null);
  const started = useRef(false);
  const { id, status } = initial;
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    if (status === "pending" && !started.current) {
      started.current = true;
      fetch(`/runs/${id}/execute`, { method: "POST" }).then(response => {
        if (!response.ok && active) setExecutionError("Execution could not be confirmed. Reload to try starting this pending run; duplicate execution is prevented.");
      }).catch(() => { if (active) setExecutionError("The execution connection was interrupted. Checking the saved run status; reload if it remains pending."); });
    }
    async function poll() {
      try {
        const response = await fetch(`/runs/${id}/status`, { cache: "no-store" });
        if (!response.ok) throw new Error("Status unavailable");
        const next: RunView = await response.json();
        if (!active) return;
        setRun(next);
        setMessage("");
        if (["pending", "running"].includes(next.status)) timer = setTimeout(poll, 1000);
      } catch {
        if (active) { setMessage("Unable to refresh status. Reconnecting… Refreshing this page will not rerun the analysis."); timer = setTimeout(poll, 3000); }
      }
    }
    if (["pending", "running"].includes(status)) timer = setTimeout(poll, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [id, status]);
  useEffect(() => {
    if (!["pending", "running"].includes(run.status)) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run.status]);
  const elapsed = (start: string | null, finish: string | null) => start ? `${Math.max(0, Math.round(((finish ? Date.parse(finish) : clock ?? Date.parse(start)) - Date.parse(start)) / 1000))}s` : "";
  const query = new URLSearchParams({ repository: `${run.input.owner}/${run.input.repo}`, ...(run.input.branch ? { branch: run.input.branch } : {}) });
  return <div className="space-y-6">
    <header className="space-y-4"><div className="flex flex-wrap items-center gap-3"><Badge variant="secondary">{run.status.replaceAll("-", " ")}</Badge><span className="text-xs text-muted-foreground">{elapsed(run.startedAt, run.finishedAt)}</span></div><h1 className="break-words text-2xl font-semibold">{run.title}</h1><p className="break-all text-sm text-muted-foreground">{run.input.owner}/{run.input.repo}{run.input.branch && ` · ${run.input.branch}`} · {run.input.head.slice(0, 7)}</p><p className="break-all font-mono text-xs text-muted-foreground">{run.input.base} → {run.input.head}</p></header>
    <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{run.summary}</p>{message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {run.status === "pending" && executionError && <p role="alert" className="text-sm text-destructive">{executionError}</p>}
    <ol aria-label="Execution timeline" className="divide-y rounded-xl border bg-card px-5">{run.stages.map(stage => {
      const Icon = stage.status === "running" ? LoaderCircle : stage.status === "completed" ? CheckCircle2 : stage.status === "failed" ? XCircle : stage.status === "skipped" ? SkipForward : Circle;
      return <li key={stage.key} className="flex gap-4 py-5"><Icon aria-hidden="true" className={`mt-1 size-5 shrink-0 ${stage.status === "running" ? "motion-safe:animate-spin text-primary" : stage.status === "failed" ? "text-destructive" : "text-muted-foreground"}`} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium">{RUN_STEPS.find(step => step.key === stage.key)?.label}</h2><span className="text-xs text-muted-foreground">{stage.status} {elapsed(stage.startedAt, stage.finishedAt)}</span></div><p className="mt-2 text-sm leading-6 text-muted-foreground">{stage.summary}</p></div></li>;
    })}</ol>
    <div className="flex flex-wrap gap-3">{run.savedAt && run.documentId && <Link href={`/documentation/drafts/${run.documentId}?${new URLSearchParams({ repository: `https://github.com/${run.input.owner}/${run.input.repo}` })}`} className={buttonVariants()}>Open saved draft</Link>}{run.hasDraft && <Link href={`/runs/${id}/review?${query}`} className={buttonVariants({ variant: run.savedAt ? "outline" : "default" })}>Review draft</Link>}{run.hasEvidence && <Link href={`/runs/${id}/evidence?${query}`} className={buttonVariants({ variant: "outline" })}>View findings & evidence</Link>}<Link href={`/changes/${run.input.head}?${query}`} className={buttonVariants({ variant: "outline" })}>Change details</Link></div>
    {!["pending", "running"].includes(run.status) && <RetryRunForm id={id} />}
    <details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">Developer details</summary><dl className="mt-4 space-y-2 text-xs text-muted-foreground"><div><dt>Run ID</dt><dd className="break-all font-mono">{id}</dd></div><div><dt>Created</dt><dd>{run.createdAt}</dd></div><div><dt>Selected context paths</dt><dd className="break-all">{run.input.paths.join(", ") || "None; changed patches supply initial evidence."}</dd></div><div><dt>Saved product context used</dt><dd>{run.contextSnapshot?.repositoryContextUsed ?? "None"}</dd></div><div><dt>Run instructions</dt><dd>{run.input.runContext ?? "None"}</dd></div></dl></details>
  </div>;
}
