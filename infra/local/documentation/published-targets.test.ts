import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { getDatabase, closeDatabase } from "@/integrations/database/client";
import { documentationDrafts, documentationPublications, documentationPublicationHistory } from "@/integrations/database/schema";
import { selectDocumentationCandidates } from "@/features/documentation/planning/select-documentation-candidates";
import { v2CandidateFixture } from "./v2-fixture";
import { validateDocumentationDocument } from "@/features/documentation/documents/document-validation";
import { transformationImpactFixture } from "./transformation-fixtures";

test("active 2-document/9-section targets survive archived and unpublished duplicate crowding", async t => {
  const repository = `https://github.com/published-target-test/${randomUUID()}`, impact = transformationImpactFixture();
  impact.provenance.source.repository = repository;
  const ids: string[] = [], publicationIds: string[] = [], historyIds: string[] = [];
  const database = getDatabase();
  t.after(async () => {
    if (publicationIds.length) await database.delete(documentationPublications).where(inArray(documentationPublications.id, publicationIds));
    if (historyIds.length) await database.delete(documentationPublicationHistory).where(inArray(documentationPublicationHistory.id, historyIds));
    if (ids.length) await database.delete(documentationDrafts).where(inArray(documentationDrafts.id, ids));
    await closeDatabase();
  });
  t.mock.method(globalThis, "fetch", () => { throw new Error("No inference allowed"); });
  const add = async (sections: number, state: "active" | "archived" | "unpublished", repo = repository) => {
    const document = v2CandidateFixture().document; document.title = "Request title guide"; document.provenance.repository = repo;
    document.sections = Array.from({ length: sections }, (_, i) => ({ ...structuredClone(document.sections[i % 2]), id: randomUUID(), title: "Request title", content: document.sections[i % 2].content.map(block => ({ ...structuredClone(block), markdown: "Request title details." })) }));
    validateDocumentationDocument(document);
    await database.insert(documentationDrafts).values({ id: document.id, document }); ids.push(document.id);
    const row = { id: randomUUID(), repository: repo, route: `/guide-${document.id}`, draftId: document.id, publishedAt: new Date() };
    if (state === "active") { await database.insert(documentationPublications).values(row); publicationIds.push(row.id); }
    if (state === "archived") { await database.insert(documentationPublicationHistory).values(row); historyIds.push(row.id); }
    return document.id;
  };
  const active = [await add(6, "active"), await add(3, "active")].sort();
  const before = await selectDocumentationCandidates(impact, { publishedOnly: true });
  await t.test("active two-document nine-section corpus remains selectable", () => {
    assert.deepEqual(before.selection.selectedDocumentIds, active); assert.equal(before.selection.matches.length, 9);
  });
  for (let i = 0; i < 14; i++) await add(4, i % 2 ? "archived" : "unpublished");
  await add(3, "active", `https://github.com/published-target-test/${randomUUID()}`);
  await t.test("archived and unpublished duplicates cannot crowd out published repository targets", async () => {
  const all = await selectDocumentationCandidates(impact);
  assert.equal(all.selection.coverage, "incomplete", "All historical snapshots would crowd out active targets");
  const result = await selectDocumentationCandidates(impact, { publishedOnly: true });
  assert.deepEqual(result.selection.selectedDocumentIds, active); assert.equal(result.selection.matches.length, 9);
  assert.equal(result.selection.coverage, "search-selected"); assert.equal(result.documents.length, 2);
  assert.deepEqual(result.selection, before.selection, "Inactive snapshots and other repositories cannot alter ranking or coverage");
  });
});
