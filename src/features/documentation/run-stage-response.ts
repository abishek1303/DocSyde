import type { WorkflowStage } from "./run-workflow-state";

export type RunResponseStage = WorkflowStage["key"] | "read-evidence" | "understand-impact" | "propose-documentation" | "validate-draft";
export type StageResponsePreview = {
  stage: RunResponseStage;
  status: "available" | "pending" | "not-used" | "unavailable";
  kind: "ai" | "result";
  preview?: string;
  message: string;
};
export type StageResponseDetail = {
  status: "available"; kind: "ai" | "result"; models: string[]; text: string;
} | { status: "pending" | "not-used" | "unavailable"; message: string };

export function shortResponse(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 240 ? `${compact.slice(0, 240).trimEnd()}…` : compact;
}
