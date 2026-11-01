import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { findDocumentationReview } from "@/integrations/database/documentation-reviews";
import { readRetainedReview } from "@/features/documentation/review/review-proposal-operations";
import { eq, asc } from "drizzle-orm";
import { getDatabase } from "@/integrations/database/client";
import { aiModelInvocations } from "@/integrations/database/schema";
import { findDocumentationRun } from "@/integrations/database/documentation-runs";
import { runRecordV2 } from "@/features/documentation/runs/run-record";
import { reliabilityManifestSchema, baselineInventory, databaseServerIdentity } from "@/features/documentation/runs/reliability-baseline";

export async function reportScenario(manifestPath: string, rawRunId: string, publicationProofPath: string | null) {
  const manifest = reliabilityManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const runId = z.uuid().parse(rawRunId);
  const inventory = await baselineInventory(manifest.baseline.repository);
  if (inventory.databaseName !== manifest.databaseName || inventory.databaseName === manifest.baseline.sourceDatabase || databaseServerIdentity() !== manifest.baseline.serverIdentity) throw new Error("Report database mismatch.");
  const run = await findDocumentationRun(runId);
  if (!run) throw new Error("Report run missing.");
  const record = runRecordV2.parse(run.payload);
  if (record.input.base !== manifest.baseline.requestDeskBase || record.input.head !== manifest.head) throw new Error("Report run mismatch.");
  const invocations = await getDatabase().select().from(aiModelInvocations).where(eq(aiModelInvocations.runId, runId)).orderBy(asc(aiModelInvocations.createdAt), asc(aiModelInvocations.id));
  const proof = publicationProofPath ? z.object({ runId: z.literal(runId), scenario: z.literal(manifest.scenario), completed: z.boolean(), restored: z.boolean(),
    savedDocumentId: z.uuid(), deliveredDocumentId: z.uuid().nullable(), publicationId: z.uuid().nullable(), proposalId: z.uuid(), proposalHash: z.string() }).passthrough().parse(JSON.parse(await readFile(publicationProofPath, "utf8"))) : null;
  const retained = record.retainedProposal ? await findDocumentationReview(record.retainedProposal.proposalId) : null;
  const review = retained ? readRetainedReview(retained) : null;
  const humanRejected = review?.review?.selection.decisions.some(decision => decision.choice === "reject") ?? false;
  const observabilityComplete = record.retainedProposal ? invocations.length === record.models.length : null;
  const firstFailed = record.stages.find(stage => stage.status === "failed");
  const outsideScope = record.reason === "outside-single-batch-baseline-scope";
  const pass = !humanRejected && review?.proposal.status === "complete" && observabilityComplete && invocations.length >= 6 && invocations.length <= 8 && proof?.completed && proof.restored && proof.savedDocumentId === proof.deliveredDocumentId
    && record.retainedProposal?.proposalId === proof.proposalId && record.retainedProposal?.proposalHash === proof.proposalHash
    && !invocations.some(invocation => invocation.status === "failed" || invocation.status === "started");
  return { version: 1, scenario: manifest.scenario, semanticType: { A: "field-default", B: "workflow-confirmation", C: "presentation-terminology" }[manifest.scenario], runId,
    frozenInference: manifest.baseline.inference, base: manifest.baseline.requestDeskBase, head: manifest.head, docsydeSha: manifest.baseline.docsydeSha,
    outcome: outsideScope ? "outside-single-batch-scope" : pass ? "pass" : humanRejected ? "did-not-complete" : record.retainedProposal ? "awaiting-review-or-publication" : "did-not-complete",
    stopReason: record.reason, sourceAssessment: record.analysis?.analysis?.assessment ?? record.analysis?.status ?? null,
    capabilitySelected: record.decision?.targets.map(target => target.capabilityId ?? null) ?? [],
    visionInvocationCount: invocations.filter(invocation => invocation.operation === "runtime-vision").length,
    selectedImageCount: selectedImageCount(invocations, record.runtime?.outcome), runtimeDecision: record.runtime?.decision ?? null,
    runtimeOutcome: record.runtime?.outcome ?? null, runtimeDetails: record.runtime ?? null,
    firstFailingStage: firstFailed?.key ?? (humanRejected ? "human-review" : null),
    observabilityComplete, review: review?.review ?? null, stages: record.stages.map(stage => ({ operation: stage.key, status: stage.status })),
    retainedProposal: record.retainedProposal ?? null, artifacts: record.artifacts, publication: proof,
    // Read safe persisted metadata/payloads only. No raw source, prompts, images or reasoning are reconstructed.
    invocations: invocations.map(invocation => ({ id: invocation.id, operation: invocation.operation, stage: invocation.stage,
      provider: invocation.provider, model: invocation.model, inputTokens: invocation.inputTokens, outputTokens: invocation.outputTokens,
      completionReason: invocation.completionReason, elapsedMs: invocation.elapsedMs, status: invocation.status, failureKind: invocation.failureKind,
      inferenceConfig: invocation.inferenceConfig, diagnostic: invocation.diagnostic,
      requestPayload: invocation.requestPayload, requestOmissionReason: invocation.requestOmissionReason,
      responsePayload: invocation.responsePayload, responseOmissionReason: invocation.responseOmissionReason })),
    limits: "Three independent observations; no causal, statistical-reliability or dollar-cost inference. Missing usage remains unavailable." };
}
function selectedImageCount(invocations: { operation: string; status: string; responsePayload: unknown }[], outcome?: string) {
  if (outcome === "not-needed" || outcome === "unavailable" || outcome === "requested-but-uncovered") return 0;
  const selection = invocations.find(invocation => invocation.operation === "visual-selection" && invocation.status === "succeeded");
  const parsed = z.object({ selected: z.array(z.unknown()) }).passthrough().safeParse(selection?.responsePayload);
  return parsed.success ? parsed.data.selected.length : null;
}
const comparisonReportSchema = z.object({
  scenario: z.enum(["A", "B", "C"]), semanticType: z.string(), outcome: z.string(), sourceAssessment: z.string().nullable(),
  runtimeDecision: z.string().nullable(), capabilitySelected: z.array(z.string().nullable()), selectedImageCount: z.number().int().nonnegative().nullable(),
  firstFailingStage: z.string().nullable(), base: z.string(), docsydeSha: z.string(), frozenInference: z.record(z.string(), z.unknown()),
  publication: z.object({ deliveredDocumentId: z.string().nullable(), restored: z.boolean() }).passthrough().nullable(),
  invocations: z.array(z.object({ operation: z.string(), inputTokens: z.number().nonnegative().nullable(), outputTokens: z.number().nonnegative().nullable(),
    completionReason: z.string().nullable(), elapsedMs: z.number().nonnegative().nullable(), status: z.string(), failureKind: z.string().nullable(),
    inferenceConfig: z.unknown(), requestOmissionReason: z.string().nullable(), responseOmissionReason: z.string().nullable() }).passthrough()),
}).passthrough();
export function comparisonMarkdown(reports: z.infer<typeof comparisonReportSchema>[]) {
  const cell = (value: unknown) => value === null || value === undefined ? "unavailable" : String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
  const rows = reports.flatMap(report => report.invocations.length ? report.invocations.map(invocation => [report.scenario, report.semanticType, report.outcome,
    report.sourceAssessment, report.runtimeDecision, JSON.stringify(report.capabilitySelected), report.selectedImageCount, invocation.operation, invocation.inputTokens, invocation.outputTokens, invocation.completionReason,
    invocation.elapsedMs, invocation.status, invocation.failureKind, JSON.stringify(invocation.inferenceConfig),
    invocation.requestOmissionReason ?? "retained", invocation.responseOmissionReason ?? "retained", report.firstFailingStage,
    report.publication?.deliveredDocumentId, report.publication?.restored]) : [[report.scenario, report.semanticType, report.outcome, report.sourceAssessment, report.runtimeDecision, JSON.stringify(report.capabilitySelected), report.selectedImageCount,
      "no invocation rows", null, null, null, null, null, null, null, null, null, report.firstFailingStage, null, report.publication?.restored]]);
  return ["# Reliability observations", "", "| Scenario | Shape | Outcome | Source | Runtime decision | Capability | Images | Operation | Input tokens | Output tokens | Completion | Latency ms | Status | Failure | Config snapshot | Request payload | Response payload | First failing stage | Delivered document | Restored |",
    "|---|---|---|---|---|---|---|---:|---:|---:|---|---:|---|---|---|---|---|---|---|---|", ...rows.map(row => `| ${row.map(cell).join(" | ")} |`), "",
    "Missing metrics are unavailable. Compare operation-level token usage, length completions, latency outliers, and repeated grounding/correspondence failures; these observations do not establish causality or statistical reliability.", ""].join("\n");
}
export async function writeComparison(paths: string[], output: string) {
  const reports = await Promise.all(paths.map(async path => comparisonReportSchema.parse(JSON.parse(await readFile(path, "utf8")))));
  if (reports.length !== 3 || new Set(reports.map(report => report.scenario)).size !== 3
    || new Set(reports.map(report => report.docsydeSha)).size !== 1 || reports.some(report => report.base !== reports[0].base || !isDeepStrictEqual(report.frozenInference, reports[0].frozenInference))) throw new Error("Comparison requires A/B/C with one baseline and DocSyde revision.");
  await writeFile(output, comparisonMarkdown(reports), { flag: "wx", mode: 0o600 });
}
