"use client";

import { MonitorPlay, Sparkles } from "lucide-react";
import { MotionReveal } from "@/components/application/motion-reveal";
import type { RunView } from "../run-record";
import type { StageResponsePreview } from "../run-stage-response";
import { StageResponse } from "./stage-response";

const codeSteps: Record<string, { running: string; completed: string }> = {
  "prepare-context": { running: "Gathering repository and product context…", completed: "Repository and product context are ready." },
  "read-evidence": { running: "Reading changed files and source evidence…", completed: "Source evidence is ready." },
  "validate-draft": { running: "Checking the generated documentation…", completed: "Documentation checks are complete." },
  "proposal-retention": { running: "Saving the proposal for your review…", completed: "The proposal is ready for your review." },
};
const thinkingSteps: Record<string, string> = {
  "source-analysis": "Analyzing source changes…",
  "understand-impact": "Summarizing product impact…",
  "runtime-decision": "Planning runtime inspection…",
  "impact-synthesis": "Summarizing product impact…",
  "documentation-planning": "Identifying documentation updates…",
  "documentation-transformation": "Preparing the documentation updates…",
  "propose-documentation": "Preparing the documentation updates…",
};

export function StageActivity({ runId, stage, label, response, summary }: {
  runId: string; stage: RunView["stages"][number]; label: string; response?: StageResponsePreview; summary: string;
}) {
  const running = stage.status === "running";
  const code = codeSteps[stage.key];
  const browser = running && stage.key === "runtime-inspection";
  const thinking = running && !code && !browser && response?.kind !== "result" && Boolean(thinkingSteps[stage.key]);
  // Each stage owns this surface. Never carry an earlier stage's result forward.
  if (stage.status === "completed" && !code && response?.kind !== "result" && response?.status === "available") {
    return <StageResponse runId={runId} stage={stage.key} label={label} response={response} />;
  }
  const deterministicResult = response?.preview ?? (stage.key === "runtime-decision" ? "Runtime inspection requirements have been checked." : stage.key === "source-analysis" ? "Source evidence has been checked." : summary);
  let text = summary;
  if (stage.status === "waiting") text = "Waiting for earlier steps to finish.";
  else if (stage.status === "skipped") text = summary || "This step was skipped.";
  else if (stage.status === "cancelled") text = "This step was cancelled.";
  else if (browser) text = "Running the configured workflow and capturing evidence…";
  else if (thinking) text = thinkingSteps[stage.key];
  else if (running && code) text = code.running;
  else if (stage.status === "completed") {
    if (code) text = code.completed;
    else if (response?.kind === "result") text = deterministicResult;
    else text = response?.message ?? "No saved output is available for this stage.";
  }
  const Icon = thinking ? Sparkles : browser ? MonitorPlay : null;
  return <MotionReveal key={`${stage.key}:${stage.status}`} className="flex min-h-56 items-center justify-center p-6">
    <div role="status" className="flex max-w-md items-center gap-3 text-sm leading-6 text-muted-foreground">
      {Icon && <Icon aria-hidden="true" className="size-5 shrink-0 text-primary motion-safe:animate-pulse" />}
      <p>{text}</p>
    </div>
  </MotionReveal>;
}
