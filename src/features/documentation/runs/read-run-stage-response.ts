import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getArtifactStorage } from "@/integrations/storage/storage";
import { getDocumentationRun } from "./run-operations";
import { getDocumentationReview } from "../review/review-proposal-operations";
import { WORKFLOW_STEPS } from "./run-workflow-state";
import { directStageResponse, projectStageResponsePreviews } from "./run-response-projection";
import type { StageResponseDetail } from "./run-stage-response";
import { visualSelectionSchema, runtimeVisualEvidenceList } from "@/features/sources/response-evidence";

const stageSchema = z.enum([...WORKFLOW_STEPS, "read-evidence", "understand-impact", "propose-documentation", "validate-draft"]);
const runtimeResponseSchema = z.object({
  selection: z.object({ selection: visualSelectionSchema, model: z.string().max(300) }).optional(),
  runtime: runtimeVisualEvidenceList,
});
export function serializeStageResponse(data: unknown, models: string[], kind: "ai" | "result" = "ai"): StageResponseDetail {
  const text = JSON.stringify(data, null, 2);
  const response = { status: "available" as const, kind, models: [...new Set(models)], text };
  if (!text || Buffer.byteLength(JSON.stringify(response)) > 256 * 1024) throw new Error("Stage response exceeds the display bound.");
  return response;
}
export async function getRunStageResponse(rawId: unknown, rawStage: unknown): Promise<StageResponseDetail | null> {
  const id = z.uuid().parse(rawId), stage = stageSchema.parse(rawStage);
  // This read enforces the same repository allowlist and integrity checks as the
  // run itself. No model/provider execution or approval operation is called.
  const run = await getDocumentationRun(id);
  if (!run) return null;
  const record = run.record;
  const direct = directStageResponse(record, stage);
  if (direct) return serializeStageResponse(direct.data, direct.models, direct.kind);
  const preview = projectStageResponsePreviews(record).find(response => response.stage === stage);
  if (!preview) return { status: "unavailable", message: "No response is available for this stage." };
  if (preview.status !== "available") return { status: preview.status, message: preview.message };
  if (!("schemaVersion" in record)) return { status: "unavailable", message: "No response was retained." };
  if (stage === "runtime-inspection") {
    const artifact = record.artifacts.find(value => value.kind === "runtime-analysis");
    if (!artifact) throw new Error("Runtime analysis reference is unavailable.");
    const bytes = await getArtifactStorage().read(artifact.key);
    if (!bytes || bytes.byteLength > 2 * 1024 * 1024 || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) throw new Error("Runtime analysis integrity failure.");
    const response = runtimeResponseSchema.parse(JSON.parse(Buffer.from(bytes).toString("utf8")));
    if (!response.selection && !response.runtime.length) return { status: "unavailable", message: "No validated AI response was retained for this inspection." };
    return serializeStageResponse({ selection: response.selection?.selection, observations: response.runtime.map(capture => ({ response: capture.vision.data })) }, [
      ...(response.selection ? [response.selection.model] : []), ...response.runtime.map(capture => capture.vision.model),
    ]);
  }
  if (stage === "documentation-transformation" && record.retainedProposal) {
    const review = await getDocumentationReview(record.retainedProposal.proposalId);
    const repository = `https://github.com/${record.input.owner.toLowerCase()}/${record.input.repo.toLowerCase()}`;
    if (review.status !== "found" || review.repository !== repository || review.proposalHash !== record.retainedProposal.proposalHash || review.proposalHash !== record.transformation?.sha256) throw new Error("Retained response identity mismatch.");
    const proposal = review.proposal;
    return serializeStageResponse({ entries: proposal.results.map(result => ({ decisionId: result.decisionId, change: result.change, generation: result.generation, support: result.support, issues: result.issues })), supportChecks: proposal.supportChecks }, record.models.filter(model => model.stage === stage).map(model => model.model));
  }
  return { status: "unavailable", message: "No response was retained for this stage." };
}
