import "server-only";
import { z } from "zod";
import { productChangeOutput } from "./product-change-analysis";
import { validateProductAnalysis, serializeProductEvidence } from "./product-change-evidence";

export const storedProductResult = z.object({
  bundle: z.object({ repository: z.string().url(), base: z.string(), head: z.string(),
    inventory: z.array(z.object({ path: z.string(), previousPath: z.string().nullable(), kind: z.string() })).max(300),
    evidence: z.array(z.object({ id: z.string(), path: z.string(), side: z.enum(["patch", "base", "head"]), commitId: z.string().nullable(), text: z.string().nullable(), status: z.string(), contentId: z.string().nullable().optional(), changed: z.boolean() })).max(1000),
    limited: z.boolean(), notice: z.string(),
  }), bytes: z.number().nonnegative().max(64 * 1024), status: z.enum(["no-change", "analyzed", "insufficient-evidence", "error"]),
  analysis: productChangeOutput.nullable(), model: z.string().optional(), elapsedMs: z.number().optional(), error: z.string().optional(),
  rejection: z.object({ stage: z.enum(["model-output", "evidence-validation"]), code: z.string(), findingIndex: z.number().optional(), citationIndex: z.number().optional() }).optional(),
}).superRefine((result, ctx) => {
  try { serializeProductEvidence(result.bundle); }
  catch { ctx.addIssue({ code: "custom", message: "Stored evidence exceeds the source budget." }); }
  if (result.analysis) {
    try { validateProductAnalysis(result.analysis, result.bundle); }
    catch { ctx.addIssue({ code: "custom", message: "Stored analysis failed evidence validation." }); }
  }
});
