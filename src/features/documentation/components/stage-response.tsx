"use client";

import { useEffect, useState } from "react";
import { Expand, LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { RunResponseStage, StageResponseDetail, StageResponsePreview } from "../run-stage-response";

type ResponseState = { status: "loading" } | { status: "error" } | { status: "loaded"; response: StageResponseDetail };
export function StageResponse({ runId, stage, label, response, stageStatus }: {
  runId: string; stage: RunResponseStage; label: string; response?: StageResponsePreview; stageStatus: string;
}) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ResponseState>({ status: "loading" });
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch(`/runs/${runId}/responses/${stage}`, { cache: "no-store", signal: controller.signal })
      .then(async result => {
        if (!result.ok) throw new Error("Response unavailable");
        const detail: StageResponseDetail = await result.json();
        if (!controller.signal.aborted) setState({ status: "loaded", response: detail });
      }).catch(() => { if (!controller.signal.aborted) setState({ status: "error" }); });
    return () => controller.abort();
  }, [open, runId, stage, attempt]);

  if (!response || response.status !== "available") {
    if (stageStatus === "waiting") return null;
    return <div className="mt-3 space-y-1 text-xs text-muted-foreground">{response?.preview && <p className="line-clamp-2">{response.preview}</p>}<p>{response?.message ?? "No saved response is available for this stage."}</p>
    </div>;
  }
  const kind = response.kind === "ai" ? "AI response" : "Stage result";
  return <Dialog open={open} onOpenChange={next => { if (next) setState({ status: "loading" }); setOpen(next); }}>
    <DialogTrigger className="mt-3 flex w-full min-w-0 items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" aria-label={`View ${kind.toLowerCase()} for ${label}`}>
      <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="mb-1 block text-xs font-medium text-primary">{kind}{response.kind === "result" && " · No AI call"}</span>
        <span className="line-clamp-2 break-words text-xs leading-6 text-muted-foreground">{response.preview || response.message}</span>
      </span>
      <Expand className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </DialogTrigger>
    <DialogContent className="flex max-h-[85dvh] min-w-0 flex-col overflow-hidden sm:max-w-3xl">
      <DialogHeader className="pr-9">
        <DialogTitle>{label} · {kind}</DialogTitle>
        <DialogDescription>The saved result from this stage.</DialogDescription>
      </DialogHeader>
      {state.status === "loading" ? <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />Loading saved response…</p>
        : state.status === "error" ? <div className="space-y-4 py-4">
          <p role="alert" className="text-sm text-muted-foreground">The saved response is unavailable. Try again or check the run’s stored data.</p>
          <Button variant="outline" onClick={() => { setState({ status: "loading" }); setAttempt(value => value + 1); }}>Try again</Button>
        </div>
          : state.response.status !== "available" ? <p role="status" className="py-5 text-sm text-muted-foreground">{state.response.message}</p>
            : <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">{state.response.models.length > 0 && <p className="break-words text-xs text-muted-foreground">{state.response.models.join(" · ")}</p>}<pre className="max-h-[60dvh] min-h-0 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-4 font-mono text-xs leading-6" tabIndex={0} aria-label={`Saved response for ${label}`}>{state.response.text}</pre>
            </div>}
    </DialogContent>
  </Dialog>;
}
