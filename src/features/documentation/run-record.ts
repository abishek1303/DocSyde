import "server-only";
import { z } from "zod";
import { productChangeInput, storedProductResult, generationContextSnapshot } from "@/features/sources/product-analysis";
import { WORKFLOW_STEPS, workflowStage, runDisposition } from "./run-workflow-state";
import { runtimeInspectionContextSchema, inspectionDecisionSchema, productImpactSchema, validateProductImpact } from "@/features/sources/product-analysis";
import { documentationHash } from "./document-identity";
import { validateDocumentationImpactPlan } from "./validate-documentation-impact-plan";
import { documentationImpactPlanSchema } from "./documentation-impact";
import { documentationChangeProposalSchema } from "./documentation-change-proposal";
const modelTiming = z.object({ model: z.string(), elapsedMs: z.number().nonnegative() });
const decisionSummary = documentationChangeProposalSchema.shape.results.element.omit({ decision: true, change: true, limitations: true });
const batchSummary = documentationChangeProposalSchema.shape.batches.element;
import { associationChoice, documentSchema } from "./document";

const stageKey = z.enum(["prepare-context", "read-evidence", "understand-impact", "propose-documentation", "validate-draft"]);
export const runInput = productChangeInput.extend({
  branch: z.string().max(1024).optional(), runContext: z.string().max(300).nullable().default(null),
  associations: z.array(associationChoice).max(20).default([]),
});
export const legacyRunRecord = z.object({
  input: runInput, title: z.string().max(500), status: z.enum(["pending", "running", "completed", "failed", "no-change", "insufficient-evidence", "interrupted"]),
  startedAt: z.string().datetime().nullable(), finishedAt: z.string().datetime().nullable(), summary: z.string(),
  stages: z.array(z.object({ key: stageKey, status: z.enum(["waiting", "running", "completed", "failed", "skipped"]), summary: z.string(), startedAt: z.string().datetime().nullable(), finishedAt: z.string().datetime().nullable() })).length(5),
  contextSnapshot: generationContextSnapshot.optional(),
  analysis: storedProductResult.optional(),
  result: z.object({ status: z.enum(["draft", "no-draft", "insufficient-evidence", "error"]), document: documentSchema.nullable(), reason: z.string().optional(), saveUnavailable: z.string().optional(), preview: z.object({ serialized: z.string(), signature: z.string() }).optional() }).optional(),
});
export type LegacyRunRecord = z.infer<typeof legacyRunRecord>;

export const runRecordV2 = z.object({
  schemaVersion: z.literal(2), input: runInput, title: z.string().max(500),
  status: z.enum(["pending", "running", "finished"]), disposition: runDisposition.nullable(),
  activeStage: z.enum(WORKFLOW_STEPS).nullable(), reason: z.string().max(500).nullable(), summary: z.string().max(2000),
  startedAt: z.iso.datetime().nullable(), finishedAt: z.iso.datetime().nullable(),
  stages: z.array(workflowStage).length(WORKFLOW_STEPS.length),
  execution: z.object({ token: z.uuid(), heartbeatAt: z.iso.datetime(), cancelRequestedAt: z.iso.datetime().nullable() }).strict().nullable(),
  contextSnapshot: generationContextSnapshot.optional(),
  runtime: runtimeInspectionContextSchema.optional(), decision: inspectionDecisionSchema.optional(),
  artifacts: z.array(z.object({ kind: z.enum(["runtime-trace", "runtime-analysis"]), key: z.uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(2).default([]),
  analysis: storedProductResult.optional(), analysisSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  impact: productImpactSchema.optional(), plan: documentationImpactPlanSchema.optional(),
  transformation: z.object({ proposalId: z.uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(["complete", "partial", "failed"]),
    results: z.array(decisionSummary).max(8), batches: z.array(batchSummary).max(8), supportAttempted: z.boolean(), supportModel: modelTiming.nullable(),
  }).strict().optional(),
  retainedProposal: z.object({ proposalId: z.uuid(), proposalHash: z.string().regex(/^[a-f0-9]{64}$/), registeredAt: z.iso.datetime(), expiresAt: z.iso.datetime() }).strict().optional(),
  models: z.array(z.object({ stage: z.enum(WORKFLOW_STEPS), model: z.string().max(300), elapsedMs: z.number().nonnegative() }).strict()).max(20).default([]),
  warnings: z.array(z.string().max(2000)).max(100).default([]),
}).strict().superRefine((r, ctx) => {
  try {
    const repository = `https://github.com/${r.input.owner.toLowerCase()}/${r.input.repo.toLowerCase()}`;
    if (r.analysis && (documentationHash(r.analysis) !== r.analysisSha256 || r.analysis.bundle.repository.toLowerCase() !== repository || r.analysis.bundle.base !== r.input.base || r.analysis.bundle.head !== r.input.head)) throw new Error("Source identity mismatch");
    if (r.impact) {
      validateProductImpact(r.impact);
      if (r.impact.provenance.source.repository.toLowerCase() !== repository || r.impact.provenance.source.base !== r.input.base || r.impact.provenance.source.head !== r.input.head) throw new Error("Impact identity mismatch");
      if (r.plan) validateDocumentationImpactPlan(r.impact, r.plan);
    } else if (r.plan) throw new Error("Plan has no impact");
  } catch { ctx.addIssue({ code: "custom", message: "Run evidence identity or graph mismatch" }); }
  if (r.stages.some((s, i) => s.key !== WORKFLOW_STEPS[i]) || (r.status === "finished") !== (r.disposition !== null && r.finishedAt !== null)
    || (r.status === "running" && !r.execution) || (r.disposition === "awaiting-review" && !r.retainedProposal)
    || (r.retainedProposal && r.disposition !== "awaiting-review")) ctx.addIssue({ code: "custom", message: "Inconsistent run state" });
});
export const runRecord = z.union([runRecordV2, z.preprocess(value => value && typeof value === "object" && "schemaVersion" in value ? null : value, legacyRunRecord)]);
export type RunRecordV2 = z.infer<typeof runRecordV2>;
export type RunRecord = z.infer<typeof runRecord>;
export type RunView = {
  schemaVersion: 1 | 2; lifecycle?: "pending" | "running" | "finished"; activeStage?: string | null; disposition?: RunRecordV2["disposition"]; input: z.infer<typeof runInput>; title: string; status: string; summary: string;
  startedAt: string | null; finishedAt: string | null; stages: (z.infer<typeof workflowStage> | LegacyRunRecord["stages"][number])[];
  contextSnapshot?: z.infer<typeof generationContextSnapshot>; runtime?: z.infer<typeof runtimeInspectionContextSchema>;
  retainedProposal?: RunRecordV2["retainedProposal"];
  outputs?: { analysisSha256?: string; impactAssessment?: string; plan?: { actionable: number; noChange: number; unresolved: number }; transformation?: { status: string; reviewReadyActions: number }; models: RunRecordV2["models"] };
  reason?: string | null;
  id: string; createdAt: string; hasDraft: boolean; hasEvidence: boolean; savedAt: string | null; documentId: string | null;
};
