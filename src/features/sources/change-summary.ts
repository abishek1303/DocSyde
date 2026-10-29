import { z } from "zod";

export const summaryInput = z.object({
  owner: z.string().trim().min(1).max(100),
  repo: z.string().trim().min(1).max(100),
  base: z.string().trim().min(1).max(1024),
  head: z.string().trim().min(1).max(1024),
}).strict();
const citation = z.object({ fileId: z.string().max(20), excerpt: z.string().min(1).max(500) }).strict();
const claim = z.object({ text: z.string().min(1).max(600), citations: z.array(citation).min(1).max(4) }).strict();
export const generatedSummary = z.object({
  observations: z.array(claim).max(8),
  effects: z.array(claim.extend({ uncertainty: z.string().min(1).max(400) })).max(5),
  unknowns: z.array(z.string().min(1).max(400)).max(8),
}).strict();
export type GeneratedSummary = z.infer<typeof generatedSummary>;
export type SummaryFile = {
  id: string; path: string; previousPath: string | null; kind: string;
  additions: number; deletions: number; patch: string | null;
  coverage: "included" | "empty" | "unavailable" | "over-budget";
  url: string; previousUrl: string | null;
};
export type SummaryResult = {
  repository: string; base: string; head: string; commits: number;
  files: SummaryFile[]; bytes: number; limited: boolean;
  summary: GeneratedSummary | null; model: string | null; elapsedMs: number | null;
  notice: string; error?: string;
};
export type AnalysisState = { result?: SummaryResult; error?: string; fieldErrors?: Record<string, string[]> };
