import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { draftFixture } from "../../../../infra/local/documentation/draft-fixture";
import { v2CandidateFixture } from "../../../../infra/local/documentation/v2-fixture";
import { transformationImpactFixture } from "../../../../infra/local/documentation/transformation-fixtures";

const load = createRequire(join(process.cwd(), "package.json"));

test("saved discovery routes survive canonical loading and candidate projection without inference", async t => {
  const baseline = draftFixture();
  baseline.title = "Request title guide";
  baseline.sections.forEach(section => {
    section.title = "Request title details";
    section.content.forEach(block => { block.markdown = "Review request title details."; });
  });
  const document = v2CandidateFixture(baseline).document;
  const route = document.context.find(a => a.id === "route-form")!;
  route.origin = "discovery";
  route.routeEvidence = { label: "Request desk", method: "file-page", commitId: document.provenance.contexts[0].head,
    sources: [{ path: "src/app/page.tsx", line: 1, excerpt: "export default function Page() {}" }], requiresConfirmation: false };
  const saved = JSON.stringify(document);
  const databasePath = load.resolve("./src/integrations/database/documentation-drafts.ts");
  const database = load(databasePath);
  const original = load.cache[databasePath]!.exports;
  load.cache[databasePath]!.exports = { ...database,
    searchDocumentationSections: async () => document.sections.map(section => ({ documentId: document.id, sectionId: section.id })),
    findDocumentationDraft: async () => ({ id: document.id, document: JSON.parse(saved), savedAt: new Date("2026-11-04T00:00:00Z") }),
  };
  const paths = ["./src/features/documentation/documents/operations.ts", "./src/features/documentation/planning/documentation-impact-input.ts", "./src/features/documentation/planning/select-documentation-candidates.ts"].map(path => load.resolve(path));
  const cached = paths.map(path => [path, load.cache[path]] as const);
  paths.forEach(path => { delete load.cache[path]; });
  t.after(() => {
    load.cache[databasePath]!.exports = original;
    for (const [path, entry] of cached) { if (entry) load.cache[path] = entry; else delete load.cache[path]; }
  });
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("No inference permitted"); });
  const { selectDocumentationCandidates }: typeof import("./select-documentation-candidates") = load(paths[2]);
  const result = await selectDocumentationCandidates(transformationImpactFixture(), { publishedOnly: true });
  assert.deepEqual(result.selection.selectedDocumentIds, [document.id]);
  assert.ok(result.documents[0].routes.includes(route.value));
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(JSON.stringify(document), saved);
});
