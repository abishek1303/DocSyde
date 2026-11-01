import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { draftFixture } from "./draft-fixture";
import { v2CandidateFixture } from "./v2-fixture";
import { getDatabase, closeDatabase } from "@/integrations/database/client";
import { documentationDrafts, documentationPublications, documentationPublicationHistory } from "@/integrations/database/schema";
import { saveDocumentationDraft, getDocumentationDraft } from "@/features/documentation/operations";
import { publishDocumentation, getContextualDocumentation, unpublishDocumentation } from "@/features/documentation/publication-operations";

test("PostgreSQL v1/v2 compatibility: existing save/publication boundaries accept immutable revision candidates", async t => {
  const owner = `revision-${randomUUID()}`, repository = `https://github.com/${owner}/product`;
  const beforeAllow = process.env.DOCSYDE_ANALYSIS_REPOSITORIES; process.env.DOCSYDE_ANALYSIS_REPOSITORIES = `${owner}/product`;
  const baseline = draftFixture(); baseline.provenance.repository = repository;
  const candidate = v2CandidateFixture(baseline).document;
  const before = structuredClone(baseline), ids = [baseline.id, candidate.id];
  t.after(async () => {
    try { await getDatabase().delete(documentationPublications).where(inArray(documentationPublications.draftId, ids));
      await getDatabase().delete(documentationPublicationHistory).where(inArray(documentationPublicationHistory.draftId, ids));
      await getDatabase().delete(documentationDrafts).where(inArray(documentationDrafts.id, ids));
    } finally { await closeDatabase(); if (beforeAllow === undefined) delete process.env.DOCSYDE_ANALYSIS_REPOSITORIES; else process.env.DOCSYDE_ANALYSIS_REPOSITORIES = beforeAllow; }
  });
  const noProviders = t.mock.method(globalThis, "fetch", () => { throw new Error("Persistence/publication tests must not call models"); });
  const constraint = await getDatabase().execute(sql`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'documentation_drafts_canonical_envelope' AND connamespace = 'docsyde'::regnamespace`);
  assert.match(String(constraint.rows[0]?.definition), /2/);
  assert.equal((await saveDocumentationDraft(baseline)).status, "saved");
  assert.equal((await saveDocumentationDraft(candidate)).status, "saved");
  const original = await getDocumentationDraft(baseline.id); assert.equal(original.status, "found");
  if (original.status === "found") assert.deepEqual(original.document, before);
  const target = { owner, repo: "product", route: "/requests/new" };
  const first = await publishDocumentation({ ...target, draftId: baseline.id }); assert.equal(first.status, "published");
  assert.equal((await getContextualDocumentation(target)).publication?.documentId, baseline.id);
  const next = await publishDocumentation({ ...target, draftId: candidate.id, observedId: first.publication!.id }); assert.equal(next.status, "published");
  const delivered = await getContextualDocumentation(target);
  assert.equal(delivered.publication?.documentId, candidate.id); assert.equal(delivered.version, 1, "Host DTO unchanged");
  const loaded = await getDocumentationDraft(candidate.id); assert.equal(loaded.status, "found");
  if (loaded.status === "found") assert.deepEqual(loaded.document, candidate);
  assert.deepEqual(await saveDocumentationDraft({ ...candidate, title: "Cannot overwrite" }), { status: "conflict" });
  const unsupportedId = randomUUID(); ids.push(unsupportedId);
  await assert.rejects(getDatabase().insert(documentationDrafts).values({ id: unsupportedId, document: { ...candidate, id: unsupportedId, schemaVersion: 3 } }));
  assert.equal((await unpublishDocumentation({ ...target, observedId: next.publication!.id })).status, "unpublished");
  assert.equal(noProviders.mock.callCount(), 0);
});
