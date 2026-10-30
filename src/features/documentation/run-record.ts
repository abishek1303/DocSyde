import "server-only";
import { z } from "zod";
import { productChangeInput, storedProductResult, generationContextSnapshot } from "@/features/sources/product-analysis";
import { associationChoice, documentSchema } from "./document";

const stageKey = z.enum(["prepare-context", "read-evidence", "understand-impact", "propose-documentation", "validate-draft"]);
export const runInput = productChangeInput.extend({
  branch: z.string().max(1024).optional(), runContext: z.string().max(300).nullable().default(null),
  associations: z.array(associationChoice).max(20).default([]),
});
export const runRecord = z.object({
  input: runInput, title: z.string().max(500), status: z.enum(["pending", "running", "completed", "failed", "no-change", "insufficient-evidence", "interrupted"]),
  startedAt: z.string().datetime().nullable(), finishedAt: z.string().datetime().nullable(), summary: z.string(),
  stages: z.array(z.object({ key: stageKey, status: z.enum(["waiting", "running", "completed", "failed", "skipped"]), summary: z.string(), startedAt: z.string().datetime().nullable(), finishedAt: z.string().datetime().nullable() })).length(5),
  contextSnapshot: generationContextSnapshot.optional(),
  analysis: storedProductResult.optional(),
  result: z.object({ status: z.enum(["draft", "no-draft", "insufficient-evidence", "error"]), document: documentSchema.nullable(), reason: z.string().optional(), saveUnavailable: z.string().optional(), preview: z.object({ serialized: z.string(), signature: z.string() }).optional() }).optional(),
});
export type RunRecord = z.infer<typeof runRecord>;
export type RunView = Omit<RunRecord, "analysis" | "result"> & { id: string; createdAt: string; hasDraft: boolean; hasEvidence: boolean; savedAt: string | null; documentId: string | null };
