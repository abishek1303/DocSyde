import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { insertDocumentationRun, findDocumentationRun, claimDocumentationRun, updateDocumentationRun, selectDocumentationRuns, selectLatestDocumentationRuns } from "@/integrations/database/documentation-runs";
import { assertAllowedRepository, pinChangeInput, readSelectedChange } from "@/features/sources/product-analysis";
import { createDraftFromChanges } from "./generate-documentation-draft";
import { runInput, runRecord, type RunRecord, type RunView } from "./run-record";
import { initialStages, advanceStage, finishStages, RUN_STEPS } from "./run-progress";
import { signDraftPreview } from "./draft-handoff";
import { getDocumentationDraft } from "./operations";
import { validateDocumentationDocument } from "./document-validation";

function repositoryIdentity(input: { owner: string; repo: string }) { return `https://github.com/${input.owner.toLowerCase()}/${input.repo.toLowerCase()}`; }
export async function createDocumentationRun(raw: unknown) {
  const input = runInput.parse(raw);
  assertAllowedRepository(input.owner, input.repo);
  if (input.associations.some(choice => choice.origin !== "operator" || choice.findingRef)) throw new Error("Associations must be explicit operator context.");
  if (new Set(input.associations.map(choice => choice.id)).size !== input.associations.length || input.associations.some(choice => choice.kind === "route" && (!choice.value.startsWith("/") || choice.value.startsWith("//") || /[?#\x00-\x20]/.test(choice.value)))) throw new Error("Check association IDs and routes.");
  const pinned = await pinChangeInput({ owner: input.owner, repo: input.repo, base: input.base, head: input.head, paths: input.paths });
  const commit = await readSelectedChange(pinned, pinned.head);
  const id = randomUUID();
  const record: RunRecord = { input: { ...input, ...pinned }, title: commit.message.split("\n")[0].slice(0, 500), status: "pending", startedAt: null, finishedAt: null, summary: "Ready to start.", stages: initialStages() };
  await insertDocumentationRun(id, repositoryIdentity(pinned), runRecord.parse(record));
  return id;
}

export async function getDocumentationRun(rawId: unknown) {
  const id = z.uuid().parse(rawId);
  const row = await findDocumentationRun(id);
  if (!row) return null;
  const record = runRecord.parse(row.payload);
  assertAllowedRepository(record.input.owner, record.input.repo);
  if (row.repository !== repositoryIdentity(record.input) || row.status !== record.status || record.stages.some((stage, index) => stage.key !== RUN_STEPS[index].key)) throw new Error("Stored run failed integrity checks.");
  if (record.result?.document) record.result.document = validateDocumentationDocument(record.result.document);
  // Request-bound execution has a bounded lifetime. Reads never resume model calls.
  if (record.status === "running" && record.startedAt && Date.now() - Date.parse(record.startedAt) > 7 * 60_000) {
    record.status = "interrupted";
    record.summary = "This run exceeded its execution window or was interrupted. Start a new attempt.";
    record.finishedAt = new Date(Date.parse(record.startedAt) + 7 * 60_000).toISOString();
    record.stages = finishStages(record.stages, true, record.summary, record.finishedAt);
  }
  let savedAt: string | null = null;
  if (record.result?.document) {
    const saved = await getDocumentationDraft(record.result.document.id, row.repository);
    if (saved.status === "found") savedAt = saved.savedAt.toISOString();
  }
  return { id, createdAt: row.createdAt.toISOString(), record, savedAt };
}
export function runView(run: NonNullable<Awaited<ReturnType<typeof getDocumentationRun>>>): RunView {
  const { analysis: _analysis, result, ...record } = run.record;
  return { ...record, id: run.id, createdAt: run.createdAt, savedAt: run.savedAt, documentId: result?.document?.id ?? null, summary: run.savedAt ? "Draft saved. Review remains available; nothing has been published." : record.summary, hasDraft: Boolean(result?.document), hasEvidence: Boolean(_analysis) };
}
export async function executeDocumentationRun(rawId: unknown) {
  const run = await getDocumentationRun(rawId);
  if (!run) throw new Error("Run not found.");
  if (run.record.status !== "pending") return;
  let record: RunRecord = { ...run.record, status: "running", startedAt: new Date().toISOString(), summary: "Run in progress." };
  if (!await claimDocumentationRun(run.id, record)) return;
  const persist = async () => { await updateDocumentationRun(run.id, record.status, runRecord.parse(record)); };
  try {
    const { associations, runContext, owner, repo, base, head, paths } = record.input;
    const input = { owner, repo, base, head, paths };
    const result = await createDraftFromChanges(input, associations, runContext, {
      onContext: async contextSnapshot => { record = { ...record, contextSnapshot }; await persist(); },
      onProgress: async event => { record = { ...record, stages: advanceStage(record.stages, event, new Date().toISOString()) }; await persist(); },
      onAnalysis: async analysis => { record = { ...record, analysis }; await persist(); },
    });
    let preview;
    let saveUnavailable;
    if (result.document) {
      try { preview = signDraftPreview(result.document); }
      catch { saveUnavailable = "Saving is unavailable until DOCSYDE_DRAFT_SIGNING_KEY is configured. Your preview remains available."; }
    }
    const status = result.document ? "completed" : result.status === "error" ? "failed" : result.status === "no-draft" ? "no-change" : "insufficient-evidence";
    const summary = result.document ? `${result.document.sections.length} proposed sections ready for review. Save the draft after reviewing it.` : status === "no-change" ? "No source differences were found for this comparison. No model calls or draft generation were needed." : result.analysisRejection?.code === "incomplete-output" ? "The model stopped before completing its response. No draft was generated. Try a new attempt or a narrower comparison." : result.reason ?? "The run did not produce a draft.";
    const now = new Date().toISOString();
    record = { ...record, status, summary, finishedAt: now, stages: finishStages(record.stages, status === "failed", summary, now), result: { status: result.status, document: result.document, reason: result.reason, preview, saveUnavailable } };
    await persist();
  } catch {
    const summary = "The run could not complete. Check repository access, configuration and evidence limits, then start a new attempt.";
    const now = new Date().toISOString();
    record = { ...record, status: "failed", summary, finishedAt: now, stages: finishStages(record.stages, true, summary, now) };
    await persist();
  }
}
export async function listDocumentationRuns(raw: unknown) {
  const input = z.object({ owner: z.string(), repo: z.string(), limit: z.number().int().min(1).max(20).default(20), before: z.object({ createdAt: z.string().datetime(), id: z.uuid() }).optional() }).parse(raw);
  assertAllowedRepository(input.owner, input.repo);
  const rows = await selectDocumentationRuns(repositoryIdentity(input), input.limit + 1, input.before && { createdAt: new Date(input.before.createdAt), id: input.before.id });
  const runs: RunView[] = [];
  for (const row of rows.slice(0, input.limit)) {
    try { const run = await getDocumentationRun(row.id); if (run) runs.push(runView(run)); } catch { /* Isolate corrupt records; never expose unvalidated content. */ }
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
    try { const run = await getDocumentationRun(row.id); if (run) result.push({ id: run.id, head: run.record.input.head, status: run.record.status }); } catch { /* Corrupt entries do not supply status badges. */ }
  }
  return result;
}
