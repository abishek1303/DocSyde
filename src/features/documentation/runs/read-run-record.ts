import "server-only";
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
  const record = runRecord.parse(row.payload);
  assertAllowedRepository(record.input.owner, record.input.repo);
  if (row.repository !== repositoryIdentity(record.input) || row.status !== record.status || (!("schemaVersion" in record) && record.stages.some((stage, index) => stage.key !== RUN_STEPS[index].key))) throw new Error("Stored run failed integrity checks.");
  let savedAt: string | null = null;
  if (!("schemaVersion" in record) && record.result?.document) {
    record.result.document = validateDocumentationDocument(record.result.document);
    const saved = await getDocumentationDraft(record.result.document.id, row.repository);
    if (saved.status === "found") savedAt = saved.savedAt.toISOString();
  }
  return { id, createdAt: row.createdAt.toISOString(), record, savedAt };
}
