import { riskCounts } from "../transformation/grounding-risk";
import "server-only";
import { assertRunReviewEligible } from "../review/run-eligibility";
import { prepareReliabilityRun } from "./reliability-baseline";
import { assertReliabilitySideEffect } from "@/integrations/reliability/execution-context";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { insertDocumentationRun, selectDocumentationRuns, selectLatestDocumentationRuns } from "@/integrations/database/documentation-runs";
import { assertAllowedRepository, pinChangeInput, readSelectedChange } from "@/features/sources/product-analysis";
import { initializeRunCoordinator } from "./run-coordinator";
import { initialWorkflowStages } from "./run-workflow-state";
import { runInput, runRecord, type RunRecord, type RunView } from "./run-record";
import { readStoredDocumentationRun } from "./read-run-record";

import { projectStageResponsePreviews } from "./run-response-projection";

function repositoryIdentity(input: { owner: string; repo: string }) { return `https://github.com/${input.owner.toLowerCase()}/${input.repo.toLowerCase()}`; }
export async function createDocumentationRun(raw: unknown) {
  assertReliabilitySideEffect("product-mutation");
  const input = runInput.parse(raw);
  assertAllowedRepository(input.owner, input.repo);
  await assertRunReviewEligible(`${input.owner}/${input.repo}`);
  const id = randomUUID();
  await prepareReliabilityRun(id, input);
  await initializeRunCoordinator();
  assertAllowedRepository(input.owner, input.repo);
  if (input.associations.some(choice => choice.origin !== "operator" || choice.findingRef || choice.routeEvidence)) throw new Error("Associations must be explicit operator context.");
  if (new Set(input.associations.map(choice => choice.id)).size !== input.associations.length || input.associations.some(choice => choice.kind === "route" && (!choice.value.startsWith("/") || choice.value.startsWith("//") || /[?#\x00-\x20]/.test(choice.value)))) throw new Error("Check association IDs and routes.");
  if (input.mode === "current-state" && input.base !== input.head) throw new Error("A current-state scan requires one revision.");
  const pinned = await pinChangeInput({ owner: input.owner, repo: input.repo, base: input.base, head: input.head, paths: input.paths });
  // Branch refs may move between independent resolves. One resolved head owns the snapshot.
  if (input.mode === "current-state") pinned.base = pinned.head;
  const commit = await readSelectedChange(pinned, pinned.head);
  const record: RunRecord = { schemaVersion: 2, disposition: null, activeStage: null, reason: null, execution: null, artifacts: [], models: [], warnings: [], input: { ...input, ...pinned }, title: input.mode === "current-state" ? `Full scan · ${input.branch ?? pinned.head.slice(0, 12)}` : commit.message.split("\n")[0].slice(0, 500), status: "pending", startedAt: null, finishedAt: null, summary: "Ready to start.", stages: initialWorkflowStages() };
  await insertDocumentationRun(id, repositoryIdentity(pinned), runRecord.parse(record), database => assertRunReviewEligible(`${input.owner}/${input.repo}`, database));
  return id;
}

export async function getDocumentationRun(rawId: unknown) {
  await initializeRunCoordinator();
  return readStoredDocumentationRun(rawId);
}
export function runView(run: NonNullable<Awaited<ReturnType<typeof getDocumentationRun>>>, { includeResponses = true }: { includeResponses?: boolean } = {}): RunView {
  const record = run.record;
  const v2 = "schemaVersion" in record;
  const document = !v2 ? record.result?.document : null;
  return { ...(includeResponses ? { responses: projectStageResponsePreviews(record) } : {}), schemaVersion: v2 ? 2 : 1, input: record.input, title: record.title,
    status: v2 ? record.disposition ?? record.status : record.status, summary: record.summary, startedAt: record.startedAt, finishedAt: record.finishedAt,
    stages: record.stages, contextSnapshot: record.contextSnapshot, ...(v2 ? { lifecycle: record.status, activeStage: record.activeStage, disposition: record.disposition,
      outputs: { sourceCoverage: record.analysis?.bundle.mode === "current-state" ? record.analysis.bundle.notice : undefined, supportRejected: record.transformation?.results.some(result => !result.reviewReady && (result.support === "unsupported" || result.support === "uncertain")), analysisSha256: record.analysisSha256, impactAssessment: record.impact?.assessment, models: record.models,
        plan: record.plan ? { actionable: record.plan.decisions.filter(d => d.action === "revise" || d.action === "add").length, noChange: record.plan.decisions.filter(d => d.action === "no-change").length, unresolved: record.plan.decisions.filter(d => d.action === "unresolved").length } : undefined,
        transformation: record.transformation ? { riskCounts: riskCounts(record.transformation.results), status: record.reviewReadiness && record.reviewReadiness.actionableDecisionIds.length < record.transformation.results.filter(result => result.generation !== "not-required").length ? "partial" : record.transformation.status, reviewReadyActions: record.reviewReadiness?.actionableDecisionIds.length ?? record.transformation.results.filter(r => r.reviewReady).length,
          batchCount: record.transformation.batches.length, plannedActions: record.transformation.results.filter(result => result.generation !== "not-required").length,
          coverageGaps: [...(record.reviewReadiness?.coverageGaps.filter(gap => record.transformation!.results.some(result => result.reviewReady && gap.startsWith(`${result.decisionId}:`))).map(gap => gap.replace(/^decision-(\d+):/, "Update $1:")) ?? []), ...record.transformation.results.flatMap((result, index) => result.generation !== "not-required" && (!result.reviewReady || result.materialization !== "ready")
            ? [`Update ${index + 1} was not fully prepared${result.issues.includes("run-budget-exhausted") ? ": the run resource budget was reached" : result.support === "unsupported" || result.support === "uncertain" ? ": wording did not pass support checks" : ": generation, validation or document assembly did not complete"}.`] : [])] } : undefined },
      failure: record.failure, runtime: record.runtime, retainedProposal: record.retainedProposal, reason: record.reason } : {}),
    id: run.id, createdAt: run.createdAt, savedAt: run.savedAt, documentId: document?.id ?? null, hasDraft: Boolean(document), hasEvidence: Boolean(record.analysis) };
}
// Compatibility entry: execution now starts a coordinator-owned task and returns immediately.
export { startDocumentationRun as executeDocumentationRun } from "./run-coordinator";
export async function listDocumentationRuns(raw: unknown) {
  const input = z.object({ owner: z.string(), repo: z.string(), limit: z.number().int().min(1).max(20).default(20), before: z.object({ createdAt: z.string().datetime(), id: z.uuid() }).optional() }).parse(raw);
  assertAllowedRepository(input.owner, input.repo);
  const rows = await selectDocumentationRuns(repositoryIdentity(input), input.limit + 1, input.before && { createdAt: new Date(input.before.createdAt), id: input.before.id });
  const runs: RunView[] = [];
  for (const row of rows.slice(0, input.limit)) {
    try { const run = await getDocumentationRun(row.id); if (run) runs.push(runView(run, { includeResponses: false })); } catch { /* Isolate corrupt records; never expose unvalidated content. */ }
  }
  const last = rows.slice(0, input.limit).at(-1);
  return { runs, nextCursor: rows.length > input.limit && last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null };
}

export async function latestDocumentationRuns(input: { owner: string; repo: string }, heads: string[]) {
  assertAllowedRepository(input.owner, input.repo);
  const ids = z.array(z.string().regex(/^[a-f0-9]{40}$/i)).max(10).parse(heads);
  const rows = await selectLatestDocumentationRuns(repositoryIdentity(input), ids);
  const result: { id: string; head: string; status: string }[] = [];
  for (const row of rows) {
    try { const run = await getDocumentationRun(row.id); if (run) result.push({ id: run.id, head: run.record.input.head, status: "schemaVersion" in run.record ? run.record.disposition ?? run.record.status : run.record.status }); } catch { /* Corrupt entries do not supply status badges. */ }
  }
  return result;
}
