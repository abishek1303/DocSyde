"use client";
import Link from "next/link";
import { RuntimeInspectionPane } from "./runtime-inspection-pane";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, LoaderCircle, XCircle, SkipForward, Square, Layers, Code2, Sparkles, Play, Activity, BookOpen, FileCheck, GitBranch, ArrowRight, Clock3, ScrollText, ExternalLink, ChevronDown } from "lucide-react";
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
  const [expandedStages, setExpandedStages] = useState<{ phase: string; stages: Record<string, boolean> }>({ phase: "", stages: {} });
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
        if (!active) return;
        setRun(next);
        setMessage("");
        const usage = await fetch(`/runs/${id}/invocations`, { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null);
        if (active && usage) setCalls(usage.invocations);
        if (!active) return;
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
  const longContext = context.length > 300;
  const elapsed = run.startedAt && run.finishedAt ? Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt)) : null;
  const duration = (ms: number) => ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round(ms % 60_000 / 1000)}s`;
  const stageIcons: Record<string, typeof Layers> = { "prepare-context": Layers, "source-analysis": Code2, "runtime-decision": Sparkles, "runtime-inspection": Play, "impact-synthesis": Activity, "documentation-planning": BookOpen, "documentation-transformation": Sparkles, "proposal-retention": FileCheck };
  const completedSummaries: Record<string, string> = { "prepare-context": "Repository and product context loaded.", "runtime-decision": "Inspection checkpoints selected.", "impact-synthesis": "Product behavior and documentation impact analyzed." };
  const outcome = runOutcome(run);
  const starting = ["pending", "running"].includes(run.status) && !blockedByReview && !executionError && run.stages.every(stage => stage.status === "waiting");
  const activeStage = run.stages.find(stage => stage.status === "running")?.key ?? (starting ? run.stages[0]?.key : undefined);
  const stagePhase = `${starting}:${run.stages.map(stage => `${stage.key}:${stage.status}`).join("|")}`;
  const tokenTotal = (key: "inputTokens" | "outputTokens") => calls.some(call => call[key] !== null) ? calls.reduce((total, call) => total + (call[key] ?? 0), 0).toLocaleString() : "—";
  const stoppedStage = failure?.stage ?? run.stages.find(stage => ["failed", "incomplete"].includes(presentedStage(run, stage).status))?.key;
  return <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
    <RunBreadcrumbs repository={`${run.input.owner}/${run.input.repo}`} branch={run.input.branch} current={id.slice(0, 8)} />
    <header className="shrink-0 space-y-3 border-b pb-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="min-w-0 flex-1 basis-64 break-words text-xl font-semibold sm:text-2xl">{run.title}</h1>


        {["pending", "running"].includes(run.status) && <Button type="button" variant="ghost" size="sm" aria-label="Cancel run" title="Cancel run" disabled={cancelling} aria-busy={cancelling} onClick={() => { void cancelRun(); }}>
          {cancelling ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : <Square aria-hidden="true" />}
          Cancel
        </Button>}
    {run.status === "awaiting-review" ? <Link href={pendingChangesHref(run)} className={buttonVariants()}><BookOpen aria-hidden="true" />Review changes<ArrowRight aria-hidden="true" /></Link> : <Button disabled title={run.reason === "proposal-review-resolved" ? "Changes have already been reviewed" : "No completed changes are available to review"}><BookOpen aria-hidden="true" />Review changes<ArrowRight aria-hidden="true" /></Button>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground"><span className="inline-flex items-center gap-2"><GitBranch aria-hidden="true" className="size-4 text-success" />{run.input.branch ?? "Pinned revision"}</span><span className="font-mono">{run.input.mode === "current-state" ? run.input.head.slice(0, 7) : `${run.input.base.slice(0, 7)} → ${run.input.head.slice(0, 7)}`}</span><span>{run.input.mode === "current-state" ? "Full Scan" : "Latest Changes"}</span></div>
      <Link href={`/ai-model-usage?${query}&runId=${id}`} className="inline-block text-sm text-primary underline underline-offset-4 lg:hidden">Usage logs</Link>
    </header>
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {run.status === "pending" && executionError && <div role="alert" className="space-y-3 text-sm"><p>{executionError}</p>{blockedByReview && <Link href={pendingChangesHref(run)} className={buttonVariants()}>Review pending changes</Link>}</div>}
    <div className="grid min-h-0 min-w-0 shrink-0 items-start gap-5 lg:grid-cols-[minmax(0,1.8fr)_minmax(16rem,1fr)]">
    <aside aria-label="Run summary and resources" className="contents lg:order-2 lg:block lg:space-y-4">
      <section className="order-1 space-y-4 rounded-xl border bg-card p-5 lg:order-none">
        <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Run summary</h2><span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">{run.status === "awaiting-review" ? "Completed" : run.status.replaceAll("-", " ")}</span></div>
        <dl className="space-y-3 text-sm"><div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-2 text-muted-foreground"><Clock3 className="size-4" aria-hidden="true" />Total time</dt><dd>{elapsed === null ? run.status === "running" ? "In progress" : "Not recorded" : duration(elapsed)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Tokens (in / out)</dt><dd className="tabular-nums">{tokenTotal("inputTokens")} / {tokenTotal("outputTokens")}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Model calls</dt><dd className="tabular-nums">{calls.length || "—"}</dd></div><div className="flex items-start justify-between gap-3"><dt className="text-muted-foreground">Outcome</dt><dd className={`text-right ${run.status === "awaiting-review" ? "text-success" : "text-muted-foreground"}`}>{run.status === "awaiting-review" ? run.outputs?.transformation?.status === "partial" ? "Partial proposal ready" : "Proposal ready" : run.status === "running" ? "In progress" : run.status === "pending" ? "Waiting to start" : run.status === "no-change" ? "No update needed" : run.status.replaceAll("-", " ")}</dd></div></dl>
    {["incomplete", "failed", "cancelled", "interrupted", "no-change"].includes(run.status) && <section aria-label="Run outcome" role={run.status === "no-change" ? "status" : "alert"} className="space-y-2 border-t pt-4">
      <h3 className="text-sm font-semibold">{outcome.title}</h3>
      {outcome.message !== outcome.title && <p className="text-sm leading-6 text-muted-foreground">{outcome.message}</p>}
      {stoppedStage && <p className="text-sm">Stopped at: {labelFor(stoppedStage)}</p>}
      {run.status !== "no-change" && <p className="text-sm text-muted-foreground">No review-ready proposal is available. Nothing was published by this run.</p>}
      <p className="text-sm leading-6">{outcome.nextStep}</p>
      <Link className="inline-block text-sm text-primary underline" href={`/runs/new?${query}&mode=full`}>Start a new Full Scan</Link>
    </section>}

    {run.status === "awaiting-review" && run.outputs?.transformation?.status === "partial" && <MotionReveal><p className="text-sm leading-6 text-warning">Some documentation updates are ready for review. Only {run.outputs.transformation.reviewReadyActions} of {run.outputs.transformation.plannedActions ?? "planned"} updates are available for review. Coverage gaps remain; review the accepted work before publishing.</p></MotionReveal>}
      {run.outputs?.transformation?.riskCounts && <p className="border-t pt-3 text-xs leading-6 text-muted-foreground">{run.outputs.transformation.riskCounts.ready} ready · {run.outputs.transformation.riskCounts.warnings} with warnings · {run.outputs.transformation.riskCounts.blocked} blocked. Human review required.</p>}
      </section>
      <div className="order-3 space-y-4 lg:order-none">
      {context && <section className="space-y-3 rounded-xl border bg-card p-5">
        <p className="text-xs font-medium text-muted-foreground">User context</p>
        <p id={`run-context-${id}`} className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{longContext && !contextExpanded ? `${context.slice(0, 300).trimEnd()}…` : context}</p>
        {longContext && <button type="button" aria-expanded={contextExpanded} aria-controls={`run-context-${id}`} onClick={() => setContextExpanded(expanded => !expanded)} className="rounded-sm text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">{contextExpanded ? "Read less" : "Read more"}</button>}
      </section>}

      <Link href={`/ai-model-usage?${query}&runId=${id}`} className="flex items-center gap-3 rounded-xl border bg-card p-5 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"><ScrollText className="size-5 shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Usage logs</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Model calls, tokens, and outputs</span></span><ExternalLink className="size-4 shrink-0" aria-hidden="true" /></Link>
      {run.input.mode === "current-state" && <ActivityDetails label="Source coverage"><p className="text-sm leading-6 text-muted-foreground">{run.outputs?.sourceCoverage ?? "Bounded current-state source sampling. Uninspected files and unobserved runtime behavior remain coverage gaps."}</p></ActivityDetails>}
      <section className="space-y-3 rounded-xl border bg-card p-5"><h2 className="text-sm font-semibold">Artifacts</h2>{!run.hasEvidence && <p className="text-xs leading-5 text-muted-foreground">No accepted source analysis was retained. Recorded model output is available in logs.</p>}{run.hasEvidence && <Link className="flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={`/runs/${id}/evidence?${query}`}><Layers className="size-4" aria-hidden="true" />Source evidence and product analysis<ArrowRight className="ml-auto size-4" aria-hidden="true" /></Link>}{run.status === "awaiting-review" && <Link className="flex items-center gap-2 text-sm text-primary underline-offset-4 hover:underline" href={pendingChangesHref(run)}><FileCheck className="size-4" aria-hidden="true" />Documentation proposal<ArrowRight className="ml-auto size-4" aria-hidden="true" /></Link>}{run.runtime?.decision === "inspect" && <RuntimeInspectionPane runId={id} terminal={!["pending", "running"].includes(run.status)} artifactsOnly />}</section>
      {run.retainedProposal && <Link href={`/runs/${id}/destinations`} className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm font-medium">Documentation destinations<ArrowRight className="ml-auto size-4" aria-hidden="true" /></Link>}
      </div>
    </aside>
    <section aria-labelledby="pipeline-title" className="order-2 flex w-full min-w-0 flex-col rounded-xl border bg-card/40 p-4 lg:order-1 lg:min-h-[38rem] lg:self-stretch lg:[contain:size]">
      <h2 id="pipeline-title" className="mb-4 text-sm font-semibold">Activity</h2>
      <ol data-run-timeline tabIndex={0} aria-label="Execution timeline" className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-1 [overflow-anchor:none] [scrollbar-width:thin]">{run.stages.map(recorded => {
        const stage = presentedStage(run, recorded);
        const startingStep = starting && stage.key === activeStage;
        const loading = stage.status === "running" || startingStep;
        const stageLabel = labelFor(stage.key);
        const response = run.responses?.find(response => response.stage === stage.key);
        const Icon = loading ? LoaderCircle : stage.status === "completed" ? CheckCircle2 : ["failed", "incomplete", "cancelled"].includes(stage.status) ? XCircle : stage.status === "skipped" ? SkipForward : Circle;
        const StageIcon = stageIcons[stage.key] ?? Layers;
        const stageDuration = stage.startedAt && stage.finishedAt ? duration(Math.max(0, Date.parse(stage.finishedAt) - Date.parse(stage.startedAt))) : null;
        const substeps = activitySubsteps(stage, calls, { supportRejected: run.outputs?.supportRejected });
        const expanded = (expandedStages.phase === stagePhase ? expandedStages.stages[stage.key] : undefined) ?? (activeStage ? stage.key === activeStage : stage.key === (stoppedStage ?? run.stages.filter(item => item.status !== "waiting").at(-1)?.key));
        return <RunStageMotion key={stage.key} status={loading ? "running" : stage.status}>
          <div className={`relative min-w-0 rounded-xl border bg-card p-4 sm:p-5 ${loading ? "border-primary/60" : "border-border"}`}>
            <div className="group/stage"><button type="button" aria-expanded={expanded} aria-controls={`stage-body-${stage.key}`} onClick={() => setExpandedStages(previous => ({ phase: stagePhase, stages: { ...(previous.phase === stagePhase ? previous.stages : {}), [stage.key]: !expanded } }))} className="grid w-full cursor-pointer text-left list-none grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 rounded-sm sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              <span data-stage-icon className="absolute -left-8 top-5 shrink-0 rounded-full bg-background"><Icon aria-hidden="true" className={`size-5 ${loading ? "motion-safe:animate-spin text-primary" : ["failed", "incomplete"].includes(stage.status) ? "text-destructive" : stage.status === "completed" ? "text-success" : "text-muted-foreground"}`} /></span>
              <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${stage.status === "completed" || loading ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}><StageIcon className="size-5" aria-hidden="true" /></span>
              <h3 aria-label={`${stageLabel}${activityBatchLabel(stage)}`} className="min-w-0 flex-1 text-sm font-semibold leading-6"><span aria-hidden="true" data-stage-title className={loading ? "text-primary" : undefined}>{`${stageLabel}${activityBatchLabel(stage)}`.split(" ").map((word, index) => <span key={index} className="inline-block whitespace-pre" data-stage-word>{word}{" "}</span>)}</span></h3>
              <span className="col-start-2 row-start-2 text-xs text-muted-foreground sm:col-auto sm:row-auto">{stageDuration && <span className="mr-2">{stageDuration}</span>}{startingStep ? "Starting…" : stage.status === "waiting" ? "Up next" : stage.status === "running" ? "In progress" : stage.status === "completed" ? "Complete" : stage.status === "incomplete" ? "Not accepted" : stage.status}</span>
              <ChevronDown aria-hidden="true" className={`col-start-3 row-start-1 mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform sm:col-auto sm:row-auto ${expanded ? "rotate-180" : ""}`} />
            </button>
            <div id={`stage-body-${stage.key}`} inert={!expanded} className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}><div className="min-h-0 overflow-hidden">{(stage.status !== "waiting" || startingStep) && <div className="mt-3 space-y-3 sm:pl-[3.25rem]">
              {!startingStep && substeps.length > 0 && <ol aria-label={`${stageLabel} steps`} className="space-y-2">{substeps.map(step => <li key={step.label} className="flex items-center gap-2 text-sm text-muted-foreground"><span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${step.status === "completed" ? "bg-primary" : step.status === "running" ? "bg-primary motion-safe:animate-pulse" : step.status === "failed" ? "bg-destructive" : "bg-border"}`} />{run.input.mode === "current-state" && step.label === "Reading changed files" ? "Reading sampled current files" : step.label}<span className="sr-only">: {step.status}</span></li>)}</ol>}
              <p className="max-w-3xl whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{startingStep ? "Starting this run…" : stage.key === "runtime-inspection" && stage.status === "skipped" ? skippedRuntimeExplanation(run) : stage.status === "completed" ? (substeps.length ? null : (completedSummaries[stage.key] ?? response?.preview ?? "This stage is complete.")) : stage.status === "running" ? "Working with the connected product and its source evidence…" : summaryFor(stage)}</p>
              {stage.key === "documentation-transformation" && !!run.outputs?.transformation?.coverageGaps?.length && <div className="space-y-2 text-sm text-muted-foreground"><p className="font-medium">Coverage gaps</p><ul className="list-disc space-y-1 pl-5">{run.outputs.transformation.coverageGaps.map(gap => <li key={gap}>{gap}</li>)}</ul></div>}
              {stage.key === "runtime-inspection" && stage.status === "skipped" && run.runtime?.outcome === "attempted-and-failed" && <RuntimeInspectionPane runId={id} terminal={!["pending", "running"].includes(run.status)} detailsOnly />}
              {showRuntimeOutput(stage) && <RuntimeInspectionPane runId={id} terminal={!["pending", "running"].includes(run.status)} />}
              {modelFailure && stage.key === failure?.stage && <ActivityDetails label="Failure details"><StageActivity key={`${id}:${stage.key}`} runId={id} stage={stage} label={stageLabel} response={response} summary={summaryFor(stage)} /><Link href={`/runs/${id}/model-failure/${encodeURIComponent(failure.stage)}?${query}`} className="block pt-4 text-sm text-primary underline">View failure details</Link></ActivityDetails>}
            </div>}
            </div></div></div>
          </div>
        </RunStageMotion>;
      })}</ol>
    </section>
    </div>

  </div>;
}
