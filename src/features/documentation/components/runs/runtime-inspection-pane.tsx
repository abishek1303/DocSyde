"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import type { InspectionView } from "../../runs/run-inspection-contract";
export function RuntimeInspectionPane({ runId, terminal }: { runId: string; terminal: boolean }) {
  const [view, setView] = useState<InspectionView | null>(null);
  const [message, setMessage] = useState("Loading runtime inspection…");
  const [expiredRevision, setExpiredRevision] = useState<number | null>(null);
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
      if (!response.ok) return;
      const blob = await response.blob();
      if (!controller.signal.aborted) { url = URL.createObjectURL(blob); setFrame({ path: framePath, url }); }
    }).catch(() => {});
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [framePath]);
  const events = view?.snapshot?.events ?? [];
  const current = events.at(-1), pathname = [...events].reverse().find(e => e.kind === "state-captured");
  const renderEvents = (items: typeof events) => <ol className="space-y-1 text-xs">{items.map(e => <li key={e.seq}>{e.seq}. {e.phase}: {e.kind.replaceAll("-", " ")}{"code" in e ? ` (${e.code})` : "limitation" in e && e.limitation ? ` (${e.limitation})` : "action" in e ? ` (${e.action}, step ${e.actionIndex + 1})` : ""}</li>)}</ol>;
  return <section aria-label="Runtime inspection" className="space-y-4 rounded-xl border bg-card p-5">
    <h2 className="text-sm font-semibold">Runtime inspection</h2>
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    <div className="space-y-2"><h3 className="text-sm font-medium">Browser activity</h3>
      <p className="text-xs">{current ? current.kind.replaceAll("-", " ") : "No browser activity recorded. Inspection may be unavailable or skipped."} {pathname?.kind === "state-captured" && pathname.pathname}</p>
      {view && <p className="text-xs text-muted-foreground">{view.status}</p>}
      {frame.url && frame.path === framePath ? <Image unoptimized width={1440} height={900} src={frame.url} alt="Latest masked runtime capture" className="max-h-72 w-full rounded border object-contain" /> : <p className="text-xs text-muted-foreground">No frame available. Frames expire; masking failures never expose pixels.</p>}
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
    {renderEvents(events.slice(-20))}
    {events.length > 20 && <details><summary className="cursor-pointer text-xs">Earlier activity ({events.length - 20})</summary>{renderEvents(events.slice(0, -20))}</details>}
    {!!view?.snapshot?.omittedEvents && <p className="text-xs">{view.snapshot.omittedEvents} events omitted by inspection limits.</p>}
  </section>;
}
