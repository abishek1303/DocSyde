"use client";

import { StageResponseContent } from "./stage-response-content";
import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { MotionReveal } from "@/components/application/motion-reveal";
import { Button } from "@/components/ui/button";
import type { RunResponseStage, StageResponseDetail, StageResponsePreview } from "../../runs/run-stage-response";

type ResponseState = { status: "loading" } | { status: "error" } | { status: "loaded"; response: StageResponseDetail };
export function StageResponse({ runId, stage, label, response }: {
  runId: string; stage: RunResponseStage; label: string; response: StageResponsePreview;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ResponseState>({ status: "loading" });
  const availability = response.status;
  useEffect(() => {
    if (availability !== "available") return;
    const controller = new AbortController();
    void fetch(`/runs/${runId}/responses/${stage}`, { cache: "no-store", signal: controller.signal })
      .then(async result => {
        if (!result.ok) throw new Error("Response unavailable");
        const detail: StageResponseDetail = await result.json();
        if (!controller.signal.aborted) setState({ status: "loaded", response: detail });
      }).catch(() => { if (!controller.signal.aborted) setState({ status: "error" }); });
    return () => controller.abort();
  }, [availability, runId, stage, attempt]);

  if (availability !== "available") return <p role="status" className="p-6 text-sm text-muted-foreground">{response.message}</p>;
  if (state.status === "loading") return <p role="status" className="flex min-h-56 items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
    <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />Loading saved response…</p>;
  if (state.status === "error") return <div className="space-y-4 p-6">
    <p role="alert" className="text-sm text-muted-foreground">The saved response is unavailable. Try again or check the run’s stored data.</p>
    <Button variant="outline" onClick={() => { setState({ status: "loading" }); setAttempt(value => value + 1); }}>Try again</Button>
  </div>;
  if (state.response.status !== "available") return <p role="status" className="p-6 text-sm text-muted-foreground">{state.response.message}</p>;
  return <MotionReveal className="min-w-0 p-5">
    <StageResponseContent text={state.response.text} preview={response.preview} stage={stage} label={label} />
  </MotionReveal>;
}
