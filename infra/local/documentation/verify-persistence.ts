import "dotenv/config";
import assert from "node:assert/strict";
import { saveDocumentationDraft, getDocumentationDraft, listDocumentationDrafts } from "@/features/documentation/operations";
import { closeDatabase } from "@/integrations/database/client";
import { draftFixture } from "./draft-fixture";

async function main() {
  delete process.env.BASETEN_API_KEY; delete process.env.GITHUB_TOKEN;
  globalThis.fetch = async () => { throw new Error("Unexpected external call"); };
  const existingId = process.argv[2];
  const document = existingId ? null : draftFixture();
  if (document) {
    const saved = await saveDocumentationDraft(document);
    assert.equal(saved.status, "saved");
  }
  await closeDatabase();
  const loaded = await getDocumentationDraft(existingId ?? document!.id);
  assert.equal(loaded.status, "found");
  if (loaded.status !== "found") throw new Error("Draft unavailable");
  if (document) assert.deepEqual(loaded.document, document);
  await listDocumentationDrafts();
  console.log(`PASS: save/load/list through a fresh connection; no AI or source calls. ID: ${loaded.document.id}`);
  console.log(`Open /documentation/drafts/${loaded.document.id}`);
  console.log(`Reopen after restart: npm run documentation:persistence:verify -- ${loaded.document.id}`);
}

main().catch(() => {
  console.error("Draft persistence verification failed. Check the ID, PostgreSQL connection and migrations.");
  process.exitCode = 1;
}).finally(closeDatabase);
