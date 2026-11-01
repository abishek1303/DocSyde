import "server-only";
import type { RunRecord } from "./run-record";
import { shortResponse, type RunResponseStage, type StageResponsePreview } from "./run-stage-response";

/** Display only validated result fields. Never project prompts, source bundles,
 * provider envelopes, artifact locations or complete retained proposals. */
export function directStageResponse(record: RunRecord, stage: RunResponseStage) {
  const v2 = "schemaVersion" in record;
  const models = v2 ? [...new Set(record.models.filter(model => model.stage === stage).map(model => model.model))] : [];
  if ((stage === "source-analysis" || stage === "understand-impact") && record.analysis?.analysis) {
    const output = record.analysis.analysis;
    return { data: output, preview: output.findings.map(finding => finding.description).join(" ") || output.assessment, kind: "ai" as const, models: record.analysis.model ? [record.analysis.model] : models };
  }
  if (v2 && stage === "runtime-decision" && record.decision) return { data: record.decision, preview: record.decision.reason, kind: models.length ? "ai" as const : "result" as const, models };
  if (v2 && stage === "impact-synthesis" && record.impact) {
    const { assessment, summary, claims, contradictions, uncertainties } = record.impact;
    return { data: { assessment, summary, claims, contradictions, uncertainties }, preview: summary, kind: "ai" as const, models };
  }
  if (v2 && stage === "documentation-planning" && record.plan) {
    const { decisions, uncertainties } = record.plan;
    return { data: { decisions, uncertainties }, preview: decisions.map(decision => decision.updateIntent || decision.reason).join(" ") || uncertainties.join(" "), kind: "ai" as const, models };
  }
  if (!v2 && stage === "propose-documentation" && record.result?.document) {
    const { title, sections } = record.result.document;
    return { data: { title, sections }, preview: title, kind: "ai" as const, models };
  }
  return null;
}
export function projectStageResponsePreviews(record: RunRecord): StageResponsePreview[] {
  const v2 = "schemaVersion" in record;
  return record.stages.map(stage => {
    const key = stage.key;
    const base = { stage: key, kind: "ai" as const };
    const direct = directStageResponse(record, key);
    if (direct) return { ...base, kind: direct.kind, status: "available", preview: shortResponse(direct.preview), message: direct.kind === "ai" ? "View AI response" : "View stage result" };
    if (v2 && key === "runtime-inspection" && record.artifacts.some(artifact => artifact.kind === "runtime-analysis")) return { ...base, status: "available", preview: record.runtimeResponsePreview, message: "View saved visual analysis" };
    if (v2 && key === "documentation-transformation" && record.retainedProposal) return { ...base, status: "available", preview: record.transformation?.responsePreview, message: "View generated changes and support checks" };
    const noModel = ["prepare-context", "proposal-retention", "read-evidence", "validate-draft"].includes(key)
      || stage.status === "skipped"
      || (key === "source-analysis" && record.analysis && record.analysis.status !== "error" && !record.analysis.model && !record.analysis.analysis)
      || (v2 && key === "runtime-decision" && stage.status === "completed" && !record.decision);
    if (noModel) return { ...base, status: "not-used", kind: "result", message: stage.status === "skipped" ? "Stage skipped. No AI response." : "No AI call at this stage." };
    const saving = v2 && key === "documentation-transformation" && record.transformation && record.status === "running";
    if (stage.status === "waiting" || stage.status === "running" || saving) return { ...base, status: "pending", preview: v2 && key === "documentation-transformation" ? record.transformation?.responsePreview : undefined, message: saving ? "Saving the response…" : "The response will appear when this stage finishes." };
    return { ...base, status: "unavailable", message: "No validated AI response was retained for this stage." };
  });
}
