"use client";
import Link from "next/link";
import { RuntimeInspectionPane } from "./runtime-inspection-pane";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, LoaderCircle, XCircle, SkipForward, Square } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { RunStageMotion } from "./run-stage-motion";
import { StageActivity } from "./stage-activity";
import { runFailureForView, runFailureDescription } from "../../runs/run-failure";
import { activityLabels, activitySubsteps, activityBatchLabel } from "../../runs/run-activity";
import type { RunInvocationSummary } from "../../runs/run-invocation-summary";
import { ActivityDetails } from "./activity-details";
import { RunBreadcrumbs } from "./run-breadcrumbs";
import { MotionReveal } from "@/components/application/motion-reveal";
import { runOutcome, presentedStage, pendingChangesHref, showRuntimeOutput, skippedRuntimeExplanation } from "../../runs/run-presentation";
import type { RunView } from "../../runs/run-record";

export function RunMonitor({ initial }: { initial: RunView }) {
  const [run, setRun] = useState(initial);
  const [calls, setCalls] = useState<RunInvocationSummary[]>([]);
  const [blockedByReview, setBlockedByReview] = useState(false);
  const [executionError, setExecutionError] = useState("");
  const [message, setMessage] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [contextExpanded, setContextExpanded] = useState(false);
  const started = useRef(false);
  const { id, status } = initial;
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    if (status === "pending" && !started.current) {
      started.current = true;
      fetch(`/runs/${id}/execute`, { method: "POST" }).then(async response => {
        if (response.status === 409) {
          const conflict = await response.json().catch(() => null);
          if (active && conflict?.code === "pending-review") { setBlockedByReview(true); setExecutionError(conflict.error); return; }
        }
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
  const labelFor = (key: string) => run.input.mode === "current-state" && key === "source-analysis" ? "Understanding current repository behavior" : activityLabels[key] ?? key.replaceAll("-", " ");
  const summaryFor = (stage: RunView["stages"][number]) => failureDescription && stage.status === "failed" ? failureDescription.message : stage.status === "incomplete" ? runOutcome(run).message : stage.status === "skipped" && ["failed", "incomplete", "interrupted", "cancelled"].includes(run.status) ? "Not run because an earlier stage stopped." : stage.summary;
  const context = run.input.runContext?.trim() ?? "";
  const longContext = context.length > 140;
  const outcome = runOutcome(run);
  const stoppedStage = failure?.stage ?? run.stages.find(stage => ["failed", "incomplete"].includes(presentedStage(run, stage).status))?.key;
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
      <Link href={`/ai-model-usage?${query}&runId=${id}`} className="inline-block text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">AI activity / Logs</Link>
      {run.input.mode === "current-state" && <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{run.outputs?.sourceCoverage ?? "Current-state scan: bounded source sampling, with up to 16 files and four findings. Coverage gaps remain; published docs require explicit review and publication."}</p>}
    </header>
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {run.status === "pending" && executionError && <div role="alert" className="space-y-3 text-sm"><p>{executionError}</p>{blockedByReview && <Link href={pendingChangesHref(run)} className={buttonVariants()}>Review pending changes</Link>}</div>}
    {["incomplete", "failed", "cancelled", "interrupted", "no-change"].includes(run.status) && <section role={run.status === "no-change" ? "status" : "alert"} className="space-y-2 rounded-xl border bg-card p-6">
      <h2 className="text-lg font-semibold">{outcome.title}</h2>
      <p className="text-sm leading-7 text-muted-foreground">{outcome.message}</p>
      {stoppedStage && <p className="text-sm">Stopped at: {labelFor(stoppedStage)}</p>}
      {run.status !== "no-change" && <p className="text-sm text-muted-foreground">No review-ready proposal is available. Nothing was published by this run.</p>}
      <p className="text-sm leading-6">{outcome.nextStep}</p>
      <Link className="inline-block text-sm text-primary underline" href={`/runs/new?${query}&mode=full`}>Start a new Full Scan</Link>
    </section>}
    {run.status === "awaiting-review" && <MotionReveal className="rounded-xl border border-primary/25 bg-accent p-6">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-primary">Ready for your review</p>
      <h2 className="text-xl font-semibold">{run.outputs?.transformation?.status === "partial" ? "Some documentation updates are ready for review." : "Documentation updates are ready for review."}</h2>
      <p className="mt-2 mb-5 text-sm text-muted-foreground">{run.outputs?.transformation?.status === "partial" ? `Only ${run.outputs.transformation.reviewReadyActions} of ${run.outputs.transformation.plannedActions ?? "the planned"} updates passed support checks. Coverage gaps remain; review only the accepted work.` : "Evidence checks passed. Review the proposed changes, exclude anything unwanted, then publish when ready."}</p>
      <Link href={pendingChangesHref(run)} className={buttonVariants()}>Review changes</Link>
    </MotionReveal>}
    <section aria-labelledby="pipeline-title" className="mx-auto w-full min-w-0 max-w-4xl">
      <h2 id="pipeline-title" className="mb-4 text-sm font-semibold">Activity</h2>
      <ol aria-label="Execution timeline" className="space-y-5">{run.stages.map(recorded => {
        const stage = presentedStage(run, recorded);
        const stageLabel = labelFor(stage.key);
        const response = run.responses?.find(response => response.stage === stage.key);
        const Icon = stage.status === "running" ? LoaderCircle : stage.status === "completed" ? CheckCircle2 : ["failed", "incomplete", "cancelled"].includes(stage.status) ? XCircle : stage.status === "skipped" ? SkipForward : Circle;
        const substeps = activitySubsteps(stage, calls, { supportRejected: run.outputs?.supportRejected });
        return <RunStageMotion key={stage.key} status={stage.status}>
          <div className="min-w-0 pl-5 sm:pl-7">
            <div className="flex items-start gap-3">
              <span data-stage-icon className="mt-0.5 shrink-0"><Icon aria-hidden="true" className={`size-5 ${stage.status === "running" ? "motion-safe:animate-spin text-primary" : ["failed", "incomplete"].includes(stage.status) ? "text-destructive" : stage.status === "completed" ? "text-success" : "text-muted-foreground"}`} /></span>
              <h3 className="flex-1 text-sm font-semibold">{stageLabel}{activityBatchLabel(stage)}</h3>
              <span className="text-xs text-muted-foreground">{stage.status === "waiting" ? "Up next" : stage.status === "running" ? "In progress" : stage.status === "completed" ? "Complete" : stage.status === "incomplete" ? "Not accepted" : stage.status}</span>
            </div>
            {stage.status !== "waiting" && <div className="mt-3 space-y-4 pl-8">
              {substeps.length > 0 && <ol aria-label={`${stageLabel} steps`} className="space-y-2">{substeps.map(step => <li key={step.label} className="flex items-center gap-2 text-xs text-muted-foreground"><span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${step.status === "completed" ? "bg-primary" : step.status === "running" ? "bg-primary motion-safe:animate-pulse" : step.status === "failed" ? "bg-destructive" : "bg-border"}`} />{run.input.mode === "current-state" && step.label === "Reading changed files" ? "Reading sampled current files" : step.label}<span className="sr-only">: {step.status}</span></li>)}</ol>}
              <p className="max-w-3xl whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">{stage.key === "runtime-inspection" && stage.status === "skipped" ? skippedRuntimeExplanation(run) : stage.status === "completed" ? response?.preview ?? "This stage is complete." : stage.status === "running" ? "Working with the connected product and its source evidence…" : summaryFor(stage)}</p>
              {stage.key === "documentation-transformation" && !!run.outputs?.transformation?.coverageGaps?.length && <div className="space-y-2 text-sm text-muted-foreground"><p className="font-medium">Coverage gaps</p><ul className="list-disc space-y-1 pl-5">{run.outputs.transformation.coverageGaps.map(gap => <li key={gap}>{gap}</li>)}</ul></div>}
              {showRuntimeOutput(stage) && <RuntimeInspectionPane runId={id} terminal={!["pending", "running"].includes(run.status)} />}
              {stage.status !== "skipped" && <ActivityDetails label="Technical details">
                <StageActivity key={`${id}:${stage.key}`} runId={id} stage={stage} label={stageLabel} response={response} summary={summaryFor(stage)} />
                {modelFailure && stage.key === failure?.stage && <Link href={`/runs/${id}/model-failure/${encodeURIComponent(failure.stage)}?${query}`} className="block pt-4 text-sm text-primary underline">View model failure details</Link>}
              </ActivityDetails>}
            </div>}
          </div>
        </RunStageMotion>;
      })}</ol>
    </section>
    <ActivityDetails label="Run context and model usage"><p className="mb-3 text-xs text-muted-foreground">Repository understanding: {run.contextSnapshot?.repositoryUnderstandingUsed?.sha.slice(0, 12) ?? "Not provided"}. Product and change context are advisory, never evidence. {run.reason ? `Recorded outcome: ${run.reason}.` : ""}</p><Link href={`/ai-model-usage?${query}&runId=${id}`} className="inline-block text-sm text-primary underline underline-offset-4">View AI model usage log</Link></ActivityDetails>
  </div>;
}
