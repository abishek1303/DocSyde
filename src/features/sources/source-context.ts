import { z } from "zod";
export const contextInput = z.object({
  owner: z.string().trim().min(1).max(100),
  repo: z.string().trim().min(1).max(100),
  revision: z.string().trim().min(1).max(1024),
  paths: z.array(z.string().min(1).max(1024)).min(1).max(100),
}).strict();
export type ContextFile = {
  path: string; contentId: string | null; size: number | null; url: string;
} & ({ status: "available"; text: string } | { status: "unavailable" | "excluded" | "error"; reason: string });
export type SourceContext = {
  repository: string; requestedRevision: string; commitId: string; files: ContextFile[];
  bytes: number; available: number; excluded: number; unavailable: number;
  complete: boolean; budgetExceeded: boolean; error?: string;
};
export type ContextState = { result?: SourceContext; error?: string; fieldErrors?: Record<string, string[]> };
