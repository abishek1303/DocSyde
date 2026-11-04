import "server-only";
import { getProposalPendingReadiness } from "../review/pending-workspace";
import { z } from "zod";
import { findDocumentationRun } from "@/integrations/database/documentation-runs";
import { assertAllowedRepository } from "@/features/sources/repository-access";
import { runRecord } from "./run-record";
import { RUN_STEPS } from "../drafts/run-progress";
import { validateDocumentationDocument } from "../documents/document-validation";
import { getDocumentationDraft } from "../documents/operations";
const repositoryIdentity = (input: { owner: string; repo: string }) => `https://github.com/${input.owner.toLowerCase()}/${input.repo.toLowerCase()}`;
// Pure authorized read. Delivery/review must not initialize execution or load model capabilities.
export async function readStoredDocumentationRun(rawId: unknown) {
  const id = z.uuid().parse(rawId);
  const row = await findDocumentationRun(id);
  if (!row) return null;
  let record = runRecord.parse(row.payload);
  assertAllowedRepository(record.input.owner, record.input.repo);
  if (row.repository !== repositoryIdentity(record.input) || row.status !== record.status || (!("schemaVersion" in record) && record.stages.some((stage, index) => stage.key !== RUN_STEPS[index].key))) throw new Error("Stored run failed integrity checks.");
  // Historical success labels are not authority for current publication eligibility.
  if ("schemaVersion" in record && record.retainedProposal && ["awaiting-review", "incomplete"].includes(record.disposition ?? "")) {
    const readiness = await getProposalPendingReadiness(`${record.input.owner}/${record.input.repo}`, record.retainedProposal.proposalId);
    const noActionable = readiness.actionableDecisionIds.length === 0;
    record = { ...record, reviewReadiness: readiness,
      ...(!noActionable && record.disposition === "incomplete" && record.reason === "proposal-no-publishable-updates" ? { disposition: "awaiting-review" as const, reason: "proposal-retained-awaiting-human-review", stages: record.stages.map(stage => stage.key === "proposal-retention" ? { ...stage, status: "completed" as const, summary: "A confirmed destination makes supported work available for review." } : stage) } : {}),
      ...(noActionable && record.disposition === "awaiting-review" ? {
        disposition: readiness.coverageGaps.length ? "incomplete" as const : "no-change" as const,
        reason: readiness.coverageGaps.length ? "proposal-no-publishable-updates" : "proposal-review-resolved",
        summary: readiness.coverageGaps.length ? "No publishable documentation updates are available." : "No pending changes remain from this run.",
        stages: record.stages.map(stage => stage.key === "proposal-retention" && readiness.coverageGaps.length ? { ...stage, status: "incomplete" as const, summary: "No publishable updates are available." } : stage),
      } : {}),
    };
  }
  let savedAt: string | null = null;
  if (!("schemaVersion" in record) && record.result?.document) {
    record.result.document = validateDocumentationDocument(record.result.document);
    const saved = await getDocumentationDraft(record.result.document.id, row.repository);
    if (saved.status === "found") savedAt = saved.savedAt.toISOString();
  }
  return { id, createdAt: row.createdAt.toISOString(), record, savedAt };
}
