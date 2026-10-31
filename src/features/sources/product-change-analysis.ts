import { z } from "zod";
import { summaryInput } from "./change-summary";
export const productChangeInput = summaryInput.extend({ paths: z.array(z.string().min(1).max(1024)).max(10) });
export const productCitation = z.object({ evidenceId: z.string().min(1).max(30).describe("Copy the enclosing evidenceId exactly."), startLine: z.number().int().min(1).describe("Copy the first number of the selected lines tuple, never a diff hunk coordinate."), endLine: z.number().int().min(1).describe("For a single tuple use the same number as startLine."), excerpt: z.string().min(1).max(600).describe("Copy exact text from the selected tuple, preserving diff prefixes, whitespace and punctuation; do not paraphrase.") }).strict();
export const productChangeOutput = z.object({
  assessment: z.enum(["product-change", "internal-only", "insufficient-evidence"]),
  findings: z.array(z.object({
    kind: z.enum(["workflow-changed", "field-requirement-changed", "capability-added", "behavior-modified", "behavior-removed", "internal-change", "undetermined"]),
    description: z.string().min(1).max(500), before: z.string().max(400).nullable(), after: z.string().max(400).nullable(),
    audience: z.string().max(200).optional(), surface: z.string().max(200).optional(),
    support: z.enum(["directly-supported", "inferred"]), confidence: z.enum(["low", "medium", "high"]),
    confidenceReason: z.string().min(1).max(300), citations: z.array(productCitation).min(1).max(4),
    // Required only for capability claims; local checks verify references, not reachability itself.
    reachabilityEvidenceIds: z.array(z.string().max(30)).max(4),
    assumptions: z.array(z.string().max(300)).max(4), uncertainties: z.array(z.string().max(300)).max(4),
  }).strict()).max(4),
  uncertainties: z.array(z.string().max(300)).max(4),
}).strict();
export type ProductAnalysis = z.infer<typeof productChangeOutput>;
export type ProductEvidence = { id: string; path: string; side: "patch" | "base" | "head"; commitId: string | null; text: string | null; status: string; contentId?: string | null; changed: boolean };
export type ProductBundle = { repository: string; base: string; head: string; evidence: ProductEvidence[]; inventory: { path: string; previousPath: string | null; kind: string }[]; limited: boolean; notice: string };
export type AnalysisRejection = { stage: "model-output" | "evidence-validation"; code: string; findingIndex?: number; citationIndex?: number };
export type ProductResult = { bundle: ProductBundle; bytes: number; status: "no-change" | "analyzed" | "insufficient-evidence" | "error"; analysis: ProductAnalysis | null; model?: string; elapsedMs?: number; error?: string; rejection?: AnalysisRejection };
export type ProductState = { result?: ProductResult; error?: string };
