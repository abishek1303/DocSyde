import { z } from "zod";
import { productChangeOutput, productCitation } from "./product-change-analysis";

const nonblank = (limit: number) => z.string().max(limit).refine(value => value.trim().length > 0);
export function isConcreteInspectionPath(path: string): boolean {
  return path.length <= 1024 && /^\/[A-Za-z0-9._~/-]*$/.test(path) && !path.includes("//")
    && !path.split("/").some(segment => segment === "." || segment === "..");
}
export const inspectionDecisionSchema = z.object({
  status: z.enum(["not-needed", "inspect", "unresolved"]),
  reason: nonblank(500),
  staticEvidence: z.enum(["sufficient", "insufficient", "uncertain"]),
  targets: z.array(z.object({
    pathname: z.string().refine(isConcreteInspectionPath).nullable(),
    description: nonblank(300),
    visibleEvidence: z.array(nonblank(300)).min(1).max(4),
    citations: z.array(productCitation).min(1).max(4),
  }).strict()).max(3),
  uncertainties: z.array(nonblank(300)).max(4),
}).strict().superRefine((decision, ctx) => {
  const invalid = decision.status === "not-needed" ? decision.targets.length !== 0
    : decision.status === "inspect" ? !decision.targets.length || decision.targets.some(target => target.pathname === null)
      : !decision.uncertainties.length || (decision.targets.length > 0 && decision.targets.every(target => target.pathname !== null));
  if (invalid) ctx.addIssue({ code: "custom", message: "Inconsistent inspection status and targets." });
});
export type InspectionDecision = z.infer<typeof inspectionDecisionSchema>;

const commit = z.string().regex(/^[a-f0-9]{40}$/i);
const path = z.string().min(1).max(1024);
export const inspectionSourceSchema = z.object({
  bundle: z.object({
    repository: z.string().min(1).max(2048), base: commit, head: commit,
    inventory: z.array(z.object({ path, previousPath: path.nullable(), kind: z.enum([
      "added", "deleted", "modified", "renamed", "copied", "type-changed",
    ]) }).strict()).max(30),
    evidence: z.array(z.object({
      id: z.string().min(1).max(30), path, side: z.enum(["patch", "base", "head"]),
      commitId: commit.nullable(), contentId: z.string().max(200).nullable().optional(),
      text: z.string().nullable(), status: z.string().min(1).max(300), changed: z.boolean(),
    }).strict()).max(50),
    limited: z.boolean(), notice: z.string().max(2000),
  }).strict(),
  bytes: z.number().int().nonnegative(),
  status: z.enum(["no-change", "analyzed", "insufficient-evidence", "error"]),
  analysis: productChangeOutput.nullable(),
  model: z.string().max(300).optional(), elapsedMs: z.number().finite().nonnegative().optional(),
  error: z.string().max(2000).optional(),
  rejection: z.object({
    stage: z.enum(["model-output", "evidence-validation"]), code: z.string().max(100),
    findingIndex: z.number().int().nonnegative().optional(), citationIndex: z.number().int().nonnegative().optional(),
  }).strict().optional(),
}).strict();
