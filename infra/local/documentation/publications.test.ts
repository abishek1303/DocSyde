import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { eq, inArray } from "drizzle-orm";
import { getDatabase, closeDatabase } from "@/integrations/database/client";
import { documentationDrafts, documentationPublications } from "@/integrations/database/schema";
import { getDocumentationDraft, saveDocumentationDraft } from "@/features/documentation/operations";
import { getContextualDocumentation, getPublication, publishDocumentation, unpublishDocumentation } from "@/features/documentation/publication-operations";
import { GET } from "@/app/api/documentation/context/route";
import { draftFixture } from "./draft-fixture";

test("PostgreSQL publication lifecycle: immutable saved docs, scoped deterministic delivery, no providers", async t => {
  const env = { BASETEN_API_KEY: process.env.BASETEN_API_KEY, GITHUB_TOKEN: process.env.GITHUB_TOKEN, DOCSYDE_ANALYSIS_REPOSITORIES: process.env.DOCSYDE_ANALYSIS_REPOSITORIES, DOCSYDE_HOST_ORIGIN: process.env.DOCSYDE_HOST_ORIGIN };
  delete process.env.BASETEN_API_KEY; delete process.env.GITHUB_TOKEN;
  const owner = `publication-${randomUUID()}`;
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = `${owner}/product,${owner}/other`;
  process.env.DOCSYDE_HOST_ORIGIN = "http://127.0.0.1:45873";
  let externalCalls = 0;
  t.mock.method(globalThis, "fetch", () => { externalCalls++; throw new Error("No external calls permitted"); });
  const target = { owner, repo: "product", route: "/requests/new" };
  const first = draftFixture(), second = draftFixture();
  for (const d of [first, second]) d.provenance.repository = `https://github.com/${owner}/product`;
  t.after(async () => {
    try {
      await getDatabase().delete(documentationPublications).where(inArray(documentationPublications.draftId, [first.id, second.id]));
      await getDatabase().delete(documentationDrafts).where(inArray(documentationDrafts.id, [first.id, second.id]));
    } finally {
      await closeDatabase();
      for (const [name, value] of Object.entries(env)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    }
  });
  await assert.rejects(() => publishDocumentation({ ...target, draftId: first.id }), /persisted/);
  await saveDocumentationDraft(first); await saveDocumentationDraft(second);
  const before = await getDocumentationDraft(first.id);
  const secondBefore = await getDocumentationDraft(second.id);
  assert.deepEqual(await getContextualDocumentation(target), { version: 1, publication: null });
  await assert.rejects(() => publishDocumentation({ ...target, repo: "other", draftId: first.id }), /mismatch/);
  await assert.rejects(() => publishDocumentation({ ...target, owner: "disallowed", draftId: first.id }), /not allowed/);
  await assert.rejects(() => publishDocumentation({ ...target, route: "/requests/:id", draftId: first.id }));
  const results = await Promise.all(Array.from({ length: 4 }, () => publishDocumentation({ ...target, draftId: first.id })));
  for (const result of results) assert.deepEqual(result, results[0]);
  const published = results[0];
  assert.equal(published.status, "published");
  if (published.status !== "published") throw new Error("not published");
  const originalId = published.publication.id;
  assert.deepEqual(await publishDocumentation({ ...target, draftId: first.id, observedId: originalId }), published);
  assert.equal((await getDatabase().select().from(documentationPublications).where(eq(documentationPublications.repository, first.provenance.repository))).length, 1);
  assert.deepEqual(await publishDocumentation({ ...target, draftId: second.id }), { status: "conflict" });
  assert.deepEqual(await publishDocumentation({ ...target, draftId: second.id, observedId: randomUUID() }), { status: "conflict" });
  for (const route of ["/requests", "/Requests/new", "/requests/123", "/requests/new/edit"]) assert.equal((await getContextualDocumentation({ ...target, route })).publication, null);
  assert.equal((await getContextualDocumentation({ ...target, repo: "other" })).publication, null);
  await assert.rejects(() => getContextualDocumentation({ ...target, route: "/requests/new/" }));
  const delivery = await getContextualDocumentation({ ...target, owner: ` ${owner.toUpperCase()} `, repo: "PRODUCT", route: "/requests/new?from=list#help" });
  assert.equal(delivery.publication?.documentId, first.id);
  assert.deepEqual(Object.keys(delivery.publication!).sort(), ["documentId", "id", "limitations", "publishedAt", "sections", "title"]);
  assert.deepEqual(delivery.publication?.sections[0].blocks, first.sections[0].content.map(b => ({ markdown: b.markdown })));
  assert.deepEqual(Object.keys(delivery.publication!.sections[0]).sort(), ["blocks", "id", "qualifications", "title"]);
  const serialized = JSON.stringify(delivery);
  for (const field of ["provenance", "evidence", "generation", "findingRef", "factRefs", "context", "excerpt", "analysisId", "model"]) assert.ok(!serialized.includes(`"${field}"`), field);
  await assert.rejects(() => getDatabase().delete(documentationDrafts).where(eq(documentationDrafts.id, first.id)));
  const replaced = await publishDocumentation({ ...target, draftId: second.id, observedId: originalId });
  assert.equal(replaced.status, "published");
  if (replaced.status !== "published") throw new Error("not replaced");
  assert.notEqual(replaced.publication.id, originalId);
  assert.equal((await getContextualDocumentation(target)).publication?.documentId, second.id);
  // Simulate storage corruption only in this isolated fixture. Delivery must
  // fail closed instead of exposing another saved draft or repairing content.
  await getDatabase().update(documentationDrafts).set({ document: { ...second, sections: [] } }).where(eq(documentationDrafts.id, second.id));
  await assert.rejects(() => getContextualDocumentation(target));
  await assert.rejects(() => publishDocumentation({ ...target, draftId: second.id }));
  await getDatabase().update(documentationDrafts).set({ document: second }).where(eq(documentationDrafts.id, second.id));
  assert.deepEqual(await unpublishDocumentation({ ...target, observedId: originalId }), { status: "conflict" });
  assert.deepEqual(await publishDocumentation({ ...target, draftId: first.id, observedId: originalId }), { status: "conflict" });
  assert.deepEqual(await unpublishDocumentation({ ...target, observedId: replaced.publication.id }), { status: "unpublished" });
  assert.equal(await getPublication(target), null);
  assert.equal((await getContextualDocumentation(target)).publication, null);
  assert.deepEqual(await getDocumentationDraft(first.id), before);
  assert.deepEqual(await getDocumentationDraft(second.id), secondBefore);
  const url = `http://localhost/api/documentation/context?owner=${owner}&repo=product&route=/requests/new`;
  const response = await GET(new Request(url, { headers: { origin: "http://127.0.0.1:45873" } }));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { version: 1, publication: null });
  assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:45873");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  const denied = await GET(new Request(url, { headers: { origin: "http://unrelated" } }));
  assert.equal(denied.status, 403); assert.equal(denied.headers.get("access-control-allow-origin"), null);
  assert.equal((await GET(new Request(url.replace("/requests/new", "/requests/:id")))).status, 400);
  assert.equal(externalCalls, 0);
  const modules = Object.keys(createRequire(`${process.cwd()}/package.json`).cache);
  assert.deepEqual(modules.filter(path => /\/(integrations\/ai|generate-documentation-draft|analyze-product-changes)/.test(path)), []);
});
