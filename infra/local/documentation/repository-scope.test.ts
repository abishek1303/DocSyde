import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { getDatabase, closeDatabase } from "@/integrations/database/client";
import { documentationDrafts } from "@/integrations/database/schema";
import { saveDocumentationDraft, listDocumentationDrafts, getDocumentationDraft } from "@/features/documentation/operations";
import { draftFixture } from "./draft-fixture";

test("repository scope precedes pagination and applies to detail reads", async t => {
  const repository = `https://github.com/scope-${randomUUID()}/product`;
  const documents = [0, 1, 2].map(index => { const document = draftFixture(); document.provenance.repository = index === 1 ? `${repository}-other` : repository; return document; });
  t.after(async () => { try { await getDatabase().delete(documentationDrafts).where(inArray(documentationDrafts.id, documents.map(document => document.id))); } finally { await closeDatabase(); } });
  for (const document of documents) await saveDocumentationDraft(document);
  assert.deepEqual((await listDocumentationDrafts({ repository: `${repository}-empty` })).entries, []);
  const page = await listDocumentationDrafts({ repository: repository.toUpperCase(), limit: 1 });
  assert.equal(page.entries.length, 1);
  assert.ok(page.nextCursor);
  const next = await listDocumentationDrafts({ repository, limit: 1, before: page.nextCursor });
  assert.equal(next.entries.length, 1);
  assert.equal(next.nextCursor, null);
  assert.deepEqual(new Set([...page.entries, ...next.entries].map(entry => entry.id)), new Set([documents[0].id, documents[2].id]));
  assert.deepEqual(await getDocumentationDraft(documents[1].id, repository), { status: "missing" });
});
