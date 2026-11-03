"use client";
import Link from "next/link";
import { RuntimeInspectionPane } from "./runtime-inspection-pane";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, LoaderCircle, XCircle, SkipForward, Square } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { RunStageMotion } from "./run-stage-motion";
import { StageActivity } from "./stage-activity";
import { runFailureForView, runFailureDescription } from "../../runs/run-failure";
import { activityLabels, activitySubsteps } from "../../runs/run-activity";
import type { RunInvocationSummary } from "../../runs/run-invocation-summary";
import { ActivityDetails } from "./activity-details";
import { RunBreadcrumbs } from "./run-breadcrumbs";
import { MotionReveal } from "@/components/application/motion-reveal";
import type { RunView } from "../../runs/run-record";

export function RunMonitor({ initial }: { initial: RunView }) {
  const [run, setRun] = useState(initial);
  const [calls, setCalls] = useState<RunInvocationSummary[]>([]);
  const [executionError, setExecutionError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [contextExpanded, setContextExpanded] = useState(false);
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
        const usage = await fetch(`/runs/${id}/invocations`, { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null);
        if (active && usage) setCalls(usage.invocations);
        if (!active) return;
        setRun(next);
        setMessage("");
        if (["pending", "running"].includes(next.status)) timer = setTimeout(poll, 1000);
      } catch {
        if (active) { setMessage("Unable to refresh status. Reconnecting… Refreshing this page will not rerun the analysis."); timer = setTimeout(poll, 3000); }
      }
    }
    timer = setTimeout(poll, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [id, status]);
  async function cancelRun() {
    setCancelling(true);
    try {
      const response = await fetch(`/runs/${id}/cancel`, { method: "POST" });
      if (!response.ok) setMessage("Cancellation could not be confirmed. Try again.");
    } catch {
      setMessage("Cancellation connection interrupted. Try again.");
    } finally {
      setCancelling(false);
    }
  }
  const query = new URLSearchParams({ repository: `${run.input.owner}/${run.input.repo}`, ...(run.input.branch ? { branch: run.input.branch } : {}) });
  const failure = runFailureForView(run);
  const failureDescription = failure ? runFailureDescription(failure.code) : null;
  const modelFailure = failure && (failure.diagnostic || failure.code.startsWith("model-") || ["evidence-validation", "transformation-failed"].includes(failure.code));
  const following = selectedStage === null;
  const liveStage = run.stages.find(stage => stage.status === "running")
    ?? run.stages.find(stage => ["failed", "incomplete", "cancelled"].includes(stage.status))
    ?? [...run.stages].reverse().find(stage => stage.status === "completed")
    ?? run.stages[0];
  const selected = run.stages.find(stage => stage.key === selectedStage) ?? liveStage;
  const labelFor = (key: string) => activityLabels[key] ?? key.replaceAll("-", " ");
  const summaryFor = (stage: RunView["stages"][number]) => failureDescription && stage.status === "failed" ? failureDescription.message : failure && stage.status === "skipped" ? "Not run because an earlier stage stopped." : stage.summary;
  const context = run.input.runContext?.trim() ?? "";
  const longContext = context.length > 140;
  const selectedResponse = run.responses?.find(response => response.stage === selected?.key);
  return <div className="space-y-6">
    <RunBreadcrumbs repository={`${run.input.owner}/${run.input.repo}`} branch={run.input.branch} current={run.title} />
    <header className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <h1 className="min-w-0 flex-1 break-words text-2xl font-semibold">{run.title}</h1>
        {["pending", "running"].includes(run.status) && <Button type="button" variant="ghost" size="sm" aria-label="Cancel run" title="Cancel run" disabled={cancelling} aria-busy={cancelling} onClick={() => { void cancelRun(); }}>
          {cancelling ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : <Square aria-hidden="true" />}
          Cancel
        </Button>}
      </div>
      {context && <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Added context</p>
        <p id={`run-context-${id}`} className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{longContext && !contextExpanded ? `${context.slice(0, 140).trimEnd()}…` : context}</p>
        {longContext && <button type="button" aria-expanded={contextExpanded} aria-controls={`run-context-${id}`} onClick={() => setContextExpanded(expanded => !expanded)} className="rounded-sm text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">{contextExpanded ? "Read less" : "Read more"}</button>}
      </div>}
    </header>
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {run.status === "pending" && executionError && <p role="alert" className="text-sm text-destructive">{executionError}</p>}
    {["incomplete", "failed", "cancelled", "interrupted", "no-change"].includes(run.status) && <section role={run.status === "no-change" ? "status" : "alert"} className="space-y-2 rounded-xl border bg-card p-6">
      <h2 className="text-lg font-semibold">{run.status === "no-change" ? "No documentation update is needed" : run.status === "cancelled" ? "This run was cancelled" : "This run needs attention"}</h2>
      <p className="text-sm leading-7 text-muted-foreground">{run.reason === "transformation-not-review-ready" ? "The generated update did not pass all grounding or evidence-support checks. No proposal is ready for review. Nothing was published." : failureDescription?.message ?? "This run ended without a review-ready update. Open the activity details to inspect the recorded outcome."}</p>
    </section>}
    {run.status === "awaiting-review" && <MotionReveal className="rounded-xl border border-primary/25 bg-accent p-6">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-primary">Ready for your review</p>
      <h2 className="text-xl font-semibold">Documentation updates are ready for review.</h2>
      <p className="mt-2 mb-5 text-sm text-muted-foreground">Evidence checks passed. You decide what to save; publication is a separate step.</p>
      <Link href={`/runs/${id}/review?${query}`} className={buttonVariants()}>Review documentation</Link>
    </MotionReveal>}
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <section aria-labelledby="pipeline-title" className="min-w-0 overflow-hidden rounded-xl border bg-card">
        <div className="border-b px-5 py-4"><h2 id="pipeline-title" className="text-sm font-semibold">Activity</h2></div>
        <ol aria-label="Execution timeline" className="divide-y px-3">{run.stages.map(stage => {
          const stageLabel = labelFor(stage.key);
          const Icon = stage.status === "running" ? LoaderCircle : stage.status === "completed" ? CheckCircle2 : ["failed", "incomplete", "cancelled"].includes(stage.status) ? XCircle : stage.status === "skipped" ? SkipForward : Circle;
          return <RunStageMotion key={stage.key} status={stage.status}>
            <button type="button" aria-pressed={selected?.key === stage.key} aria-controls="stage-output" onClick={() => setSelectedStage(stage.key)} className="flex w-full min-w-0 items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-accent motion-reduce:transition-none">
              <span data-stage-icon className="mt-0.5 inline-flex size-5 shrink-0"><Icon aria-hidden="true" className={`size-5 ${stage.status === "running" ? "motion-safe:animate-spin text-primary" : ["failed", "incomplete", "cancelled"].includes(stage.status) ? "text-destructive" : stage.status === "completed" ? "text-success" : "text-muted-foreground"}`} /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{stageLabel}</span><span className="mt-1 block text-xs text-muted-foreground">{stage.status === "waiting" ? "Up next" : stage.status === "running" ? "In progress" : stage.status === "completed" ? "Complete" : stage.status}</span></span>
            </button>
            {(stage.status !== "waiting" && activitySubsteps(stage, calls).length > 0) && <ol aria-label={`${stageLabel} steps`} className="mb-3 ml-8 space-y-2 border-l border-primary/20 pl-5">{activitySubsteps(stage, calls).map(step => <li key={step.label} className="flex items-center gap-2 text-xs text-muted-foreground"><span aria-hidden="true" className={`size-1.5 rounded-full ${step.status === "completed" ? "bg-primary" : step.status === "running" ? "bg-primary motion-safe:animate-pulse" : step.status === "failed" ? "bg-destructive" : "bg-border"}`} />{step.label}<span className="sr-only">: {step.status}</span></li>)}</ol>}
          </RunStageMotion>;
        })}</ol>
      </section>
      <section id="stage-output" aria-label="Stage activity" className="min-w-0 overflow-hidden rounded-xl border bg-card">
        {!following && <div className="flex justify-end px-5 pt-4">
          <Button variant="ghost" size="sm" onClick={() => setSelectedStage(null)}>Follow pipeline</Button>
        </div>}
        {selected?.key === "runtime-inspection" ? <RuntimeInspectionPane runId={id} terminal={!["pending", "running"].includes(run.status)} /> : selected && <div className="space-y-5 p-5 sm:p-6">
          <div><p className="mb-2 text-xs text-muted-foreground">{["pending", "running"].includes(run.status) ? "DocSyde is working" : "Recorded activity"}</p><h2 className="text-lg font-semibold">{labelFor(selected.key)}</h2></div>
          <p role="status" className="text-sm leading-7 text-muted-foreground">{selected.status === "completed" ? selectedResponse?.preview ?? "This step is complete." : selected.status === "waiting" ? "This step will begin after the earlier work finishes." : selected.status === "running" ? "Working with the connected product and its source evidence…" : summaryFor(selected)}</p>
        </div> }
        {selected?.key !== "runtime-inspection" && run.activeStage === "runtime-inspection" && <RuntimeInspectionPane runId={id} terminal={!["pending", "running"].includes(run.status)} />}
        {selected && <div className="px-5 pb-5"><ActivityDetails label={`Details · ${labelFor(selected.key)}`}>
          <p className="mb-3 text-xs text-muted-foreground">Internal operation: {selected.key} · {selected.status}</p>
          {calls.filter(call => call.stage === selected.key).map(call => <p key={call.id} className="mb-2 break-words text-xs text-muted-foreground">{call.operation} · {call.provider} · {call.model ?? "Model pending"} · {call.status}{call.elapsedMs !== null ? ` · ${call.elapsedMs} ms` : ""} · {call.inputTokens ?? "—"} input / {call.outputTokens ?? "—"} output tokens</p>)}
          <StageActivity key={`${id}:${selected.key}`} runId={id} stage={selected} label={labelFor(selected.key)} response={selectedResponse} summary={summaryFor(selected)} />
        </ActivityDetails></div>}
        {modelFailure && selected?.key === failure?.stage && <p className="px-6 pb-6 text-sm"><Link href={`/runs/${id}/model-failure/${encodeURIComponent(failure.stage)}?${query}`} className="text-primary underline underline-offset-4">View model failure details</Link></p>}
        {failureDescription && !modelFailure && selected?.key === failure?.stage && <p className="px-6 pb-6 text-sm leading-6 text-muted-foreground">{failureDescription.nextStep}</p>}
        {following && !["pending", "running"].includes(run.status) && (run.retainedProposal || run.hasDraft || (run.savedAt && run.documentId)) && <div className="px-5 pb-5">
          {run.savedAt && run.documentId ? <Link href={`/documentation/drafts/${run.documentId}?${new URLSearchParams({ repository: `https://github.com/${run.input.owner}/${run.input.repo}` })}`} className={buttonVariants()}>Open saved draft</Link>
            : <Link href={`/runs/${id}/review?${query}`} className={buttonVariants()}>Review documentation</Link>}
        </div>}
      </section>
    </div>
    <ActivityDetails label="Run context and model usage"><p className="mb-3 text-xs text-muted-foreground">Repository understanding: {run.contextSnapshot?.repositoryUnderstandingUsed?.sha.slice(0, 12) ?? "Not provided"}. Product and change context are advisory, never evidence. {run.reason ? `Recorded outcome: ${run.reason}.` : ""}</p><Link href={`/ai-model-usage?${query}&runId=${id}`} className="inline-block text-sm text-primary underline underline-offset-4">View AI model usage log</Link></ActivityDetails>
  </div>;
}
