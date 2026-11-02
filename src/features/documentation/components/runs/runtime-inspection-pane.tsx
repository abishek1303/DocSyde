"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { inspectionEventLabel, runtimeFailureMessage } from "../../runs/run-inspection-presentation";
import type { InspectionView } from "../../runs/run-inspection-contract";
export function RuntimeInspectionPane({ runId, terminal }: { runId: string; terminal: boolean }) {
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
  const framePath = retained ? `/runs/${runId}/inspection/screenshots/${retained.captureId}` : preview ? `/runs/${runId}/inspection/preview/${preview.revision}` : canonical ? `/runs/${runId}/inspection/screenshots/${canonical.captureId}` : "";
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
  return <section aria-label="Runtime inspection" className="space-y-4 rounded-xl border bg-card p-5">
    <div><h2 className="text-sm font-semibold">Runtime inspection</h2><p className="mt-1 text-xs text-muted-foreground">Read-only view of the same Playwright session used for runtime evidence.</p></div>
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {failureCode && <div role="alert" className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"><p className="font-medium">Inspection stopped: {failureCode}</p><p>{runtimeFailureMessage(failureCode)}</p>{!failure && <p className="text-xs text-muted-foreground">Retained run diagnostic; no event history was reconstructed.</p>}</div>}
    <div className="space-y-2"><h3 className="text-sm font-medium">Browser activity</h3>
      <p className="text-xs">{current ? inspectionEventLabel(current) : "No browser activity recorded. Inspection may be unavailable or skipped."}</p>
      {view && <p className="text-xs text-muted-foreground">{view.status}</p>}
      <div className="overflow-hidden rounded-lg border bg-muted/20"><div className="flex items-center gap-3 border-b bg-muted/50 px-3 py-2 text-xs"><span aria-hidden="true">● ● ●</span><span className="min-w-0 break-all font-mono">{pathname && "pathname" in pathname ? pathname.pathname : "Waiting for navigation"}</span><span className="ml-auto shrink-0 text-muted-foreground">Read only</span></div>
      {frame.url && frame.path === framePath ? <Image unoptimized width={1440} height={900} src={frame.url} alt="Latest masked runtime capture" className="max-h-72 w-full rounded border object-contain" /> : <p className="text-xs text-muted-foreground">{frameError === framePath && framePath ? "Screenshot unavailable. The event timeline remains available." : "No frame available. Frames expire; masking failures never expose pixels."}</p>}
      </div>
      <p className="text-xs">{retained || (!preview && canonical) ? "Retained evidence" : preview ? terminal ? "Not retained" : "Provisional preview — capture is not yet retained evidence" : "No captured frame"}</p>
    </div>
    <div className="space-y-2"><h3 className="text-sm font-medium">Captured evidence</h3>
      <div className="flex flex-wrap gap-2">{view?.captures.map(cp => <a key={cp.captureId} href={`/runs/${runId}/inspection/screenshots/${cp.captureId}`} className="text-xs"><Image unoptimized width={96} height={64} loading="lazy" src={`/runs/${runId}/inspection/screenshots/${cp.captureId}`} alt="Retained masked checkpoint" className="h-16 w-24 rounded border object-contain" />{cp.selected ? "Selected for analysis" : "Retained"}</a>)}</div>
      {!view?.captures.length && <p className="text-xs">No canonical evidence retained.</p>}
    </div>
    <div className="space-y-2"><h3 className="text-sm font-medium">Model analysis</h3>
      {!view?.analysis.length && <p className="text-xs">Vision has not produced retained observations. Selection may be skipped, failed, or not started.</p>}
      {view?.analysis.map((a, i) => <div key={i} className="text-xs"><ul>{a.observations.map((text, j) => <li key={j}>{text}</li>)}</ul><p>Limitations: {a.limitations.join("; ") || "None reported"}</p></div>)}
    </div>
    {!!checkpoints.length && <details><summary className="cursor-pointer text-xs">Captured checkpoints ({checkpoints.length})</summary><ol className="mt-2 space-y-2 text-xs">{checkpoints.map(e => e.kind === "checkpoint-created" && <li key={e.seq}><code className="break-all">{e.captureId}</code> · {e.eligible ? "Masked capture" : `Unavailable (${e.limitation})`}</li>)}</ol></details>}
    <div><h3 className="mb-2 text-sm font-medium">Inspection timeline</h3>{!events.length && <p className="text-xs text-muted-foreground">This run has no retained inspection events.</p>}{renderEvents(events.slice(-20))}</div>
    {events.length > 20 && <details><summary className="cursor-pointer text-xs">Earlier activity ({events.length - 20})</summary>{renderEvents(events.slice(0, -20))}</details>}
    {!!view?.snapshot?.omittedEvents && <p className="text-xs">{view.snapshot.omittedEvents} events omitted by inspection limits.</p>}
  </section>;
}
