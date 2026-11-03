"use client";
import Image from "next/image";
import { MotionReveal } from "@/components/application/motion-reveal";
import { ActivityDetails } from "./activity-details";
import { useEffect, useState } from "react";
import { inspectionEventLabel, runtimeFailureMessage } from "../../runs/run-inspection-presentation";
import type { InspectionView } from "../../runs/run-inspection-contract";
export function RuntimeInspectionPane({ runId, terminal }: { runId: string; terminal: boolean }) {
  const [selectedCapture, setSelectedCapture] = useState<string | null>(null);
  const [view, setView] = useState<InspectionView | null>(null);
  const [message, setMessage] = useState("Loading runtime inspection…");
  const [expiredRevision, setExpiredRevision] = useState<number | null>(null);
  const [frameError, setFrameError] = useState("");
  const [frame, setFrame] = useState({ path: "", url: "" });
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/runs/${runId}/inspection`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const next: InspectionView = await response.json();
        if (controller.signal.aborted) return;
        setView(next); setMessage("");
        if (!terminal) timer = setTimeout(poll, 1000);
      } catch { if (!controller.signal.aborted) { setMessage("Inspection unavailable. Reconnecting…"); timer = setTimeout(poll, 3000); } }
    }
    void poll(); // Effect reruns for the final terminal fetch.
    return () => { controller.abort(); clearTimeout(timer); };
  }, [runId, terminal]);
  const revision = view?.snapshot?.preview?.revision;
  useEffect(() => {
    if (!terminal || revision === undefined) return;
    const timer = setTimeout(() => setExpiredRevision(revision), 59_000);
    return () => clearTimeout(timer);
  }, [terminal, revision]);
  const preview = revision !== expiredRevision ? view?.snapshot?.preview : null;
  const retained = view?.captures.find(cp => cp.captureId === preview?.captureId);
  const canonical = view?.captures.at(-1);
  const framePath = selectedCapture && view?.captures.some(cp => cp.captureId === selectedCapture) ? `/runs/${runId}/inspection/screenshots/${selectedCapture}` : retained ? `/runs/${runId}/inspection/screenshots/${retained.captureId}` : preview ? `/runs/${runId}/inspection/preview/${preview.revision}` : canonical ? `/runs/${runId}/inspection/screenshots/${canonical.captureId}` : "";
  useEffect(() => {
    const controller = new AbortController(); let url = "";
    if (framePath) void fetch(framePath, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) { if (!controller.signal.aborted) setFrameError(framePath); return; }
      const blob = await response.blob();
      if (!controller.signal.aborted) { url = URL.createObjectURL(blob); setFrame({ path: framePath, url }); }
    }).catch(() => { if (!controller.signal.aborted) setFrameError(framePath); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [framePath]);
  const events = view?.snapshot?.events ?? [];
  const current = events.at(-1), pathname = [...events].reverse().find(e => "pathname" in e && e.pathname);
  const genericFailures = new Set(["run-failed", "capture-failed", "runtime-start-failed", "not-retained"]);
  const failure = [...events].reverse().find(e => e.kind === "failure" && !genericFailures.has(e.code)) ?? [...events].reverse().find(e => e.kind === "failure");
  const failureCode = failure?.kind === "failure" ? failure.code : view?.diagnostic?.code;
  const checkpoints = events.filter(e => e.kind === "checkpoint-created");
  const renderEvents = (items: typeof events) => <ol className="space-y-2 text-xs">{items.map(e => <li key={e.seq} className="border-l-2 border-muted pl-3">
    <div className="flex flex-wrap gap-x-2"><time dateTime={e.at}>{new Date(e.at).toLocaleTimeString()}</time><span className="font-medium">{inspectionEventLabel(e)}</span></div>
    <span className="text-muted-foreground">{e.seq}. {e.phase}: {e.kind.replaceAll("-", " ")}{"code" in e ? ` (${e.code})` : ""}</span>
    {"captureId" in e && <code className="ml-2 break-all text-muted-foreground">{e.captureId}</code>}
  </li>)}</ol>;
  const milestones = [
    { label: "Starting browser session", start: "browser-launch-started", end: "browser-launched" },
    { label: "Navigating the workflow", start: "navigation-started", end: "navigation-completed" },
    { label: "Capturing checkpoints", start: "state-captured", end: "checkpoint-created" },
    { label: "Selecting visual evidence", start: "visual-selection-started", end: "visual-selection-completed" },
    { label: "Analyzing screenshots", start: "vision-analysis-started", end: "vision-analysis-completed" },
  ];
  return <section aria-label="Runtime inspection" className="min-w-0 space-y-5">
    <header>
      <p role="status" className="mt-2 text-sm leading-6 text-muted-foreground">{current ? inspectionEventLabel(current) : terminal ? "Recorded inspection evidence" : "Waiting for the browser session"}</p></header>
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {failureCode && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">{runtimeFailureMessage(failureCode)}</div>}
    <ol aria-label="Browser inspection steps" className="flex flex-wrap gap-x-5 gap-y-2">{milestones.map(step => {
      const start = [...events].reverse().find(e => e.kind === step.start);
      const end = [...events].reverse().find(e => e.kind === step.end);
      const complete = end && ((step.end === "checkpoint-created" && events.some(e => e.kind === "visual-selection-started")) || !start || end.seq > start.seq);
      return <li key={step.label} className={`flex items-center gap-2 text-xs ${complete ? "text-foreground" : "text-muted-foreground"}`}><span aria-hidden="true" className={`size-1.5 rounded-full ${complete ? "bg-primary" : start && !terminal ? "bg-primary motion-safe:animate-pulse" : "bg-border"}`} />{step.label}<span className="sr-only">{complete ? ": complete" : start ? terminal ? ": incomplete" : ": started" : ": not recorded"}</span></li>;
    })}</ol>
    {framePath && <div className="overflow-hidden rounded-xl border bg-muted/20">
      <div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground"><span aria-hidden="true">● ● ●</span><span className="truncate">{pathname && "pathname" in pathname ? pathname.pathname : "Connected product"}</span><span className="ml-auto shrink-0">Masked capture</span></div>
      <div className="relative flex aspect-[16/10] max-h-[32rem] w-full items-center justify-center">
        {frame.url && frame.path === framePath ? <MotionReveal key={frame.path} className="absolute inset-0"><Image unoptimized fill sizes="(max-width: 1024px) 100vw, 720px" src={frame.url} alt="Latest masked runtime capture" className="object-contain" /></MotionReveal> : <p className="max-w-xs p-6 text-center text-sm leading-6 text-muted-foreground">{frameError === framePath && framePath ? "Screenshot unavailable. Recorded activity is available in details." : "Browser screenshots will appear here as the workflow reaches checkpoints."}</p>}
      </div>
    </div>}
    <p className="text-xs text-muted-foreground">{selectedCapture || retained || (!preview && canonical) ? "Retained evidence" : preview ? "Live masked preview · not yet retained evidence" : "No frame recorded yet"}. Screenshots show observed state, not proof of all product behavior.</p>
    {!!view?.captures.length && <div><div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-medium text-muted-foreground">Captured evidence</h3>{selectedCapture && <button className="text-xs text-primary underline" onClick={() => setSelectedCapture(null)}>Follow latest capture</button>}</div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">{view.captures.map((cp, index) => <button type="button" aria-pressed={selectedCapture === cp.captureId} key={cp.captureId} onClick={() => setSelectedCapture(cp.captureId)} className="min-w-0 text-left focus-visible:outline-2 focus-visible:outline-ring"><Image unoptimized width={192} height={120} loading="lazy" src={`/runs/${runId}/inspection/screenshots/${cp.captureId}`} alt={`Masked checkpoint ${index + 1}`} className="aspect-[16/10] w-full rounded-md border object-contain aria-pressed:border-primary" /><span className="mt-1 block text-[11px] text-muted-foreground">Checkpoint {index + 1}{cp.selected ? " · selected" : ""}</span></button>)}</div>
    </div>}
    {!!view?.analysis.length && <div className="space-y-3"><h3 className="text-sm font-medium">What DocSyde observed</h3><ul className="list-disc space-y-2 pl-4 text-sm leading-6 text-muted-foreground">{view.analysis.flatMap(a => a.observations).map((text, i) => <li key={i}>{text}</li>)}</ul></div>}
    <ActivityDetails label="Inspection details and evidence limitations">
      <p className="mb-3 text-xs text-muted-foreground">{view?.status} · {checkpoints.length} checkpoints recorded</p>
      {view?.analysis.map((a, i) => <p key={i} className="mb-3 text-xs leading-6 text-muted-foreground">{a.limitations.join("; ")}</p>)}
      {renderEvents(events)}
      {!!view?.snapshot?.omittedEvents && <p className="text-xs">{view.snapshot.omittedEvents} events omitted by inspection limits.</p>}
    </ActivityDetails>
  </section>;
}
