import { test } from "node:test";
import assert from "node:assert/strict";
import { draftFixture } from "../../../../infra/local/documentation/draft-fixture";
import { transformationImpactFixture } from "../../../../infra/local/documentation/transformation-fixtures";
import { projectSectionContexts } from "../documents/section-context";
import { candidateQuery, candidateSelectionSchema, matchSection, textTokens } from "./candidate-selection";
import { documentationHash } from "../documents/document-identity";

function requestDocument() {
  const d = draftFixture(); d.title = "Request guide"; d.sections[0].title = "Title validation";
  d.sections[0].content[0].markdown = "A request title is required.";
  return d;
}
test("typed context preserves immutable identity, purpose and explicit/inferred provenance without enrichment", () => {
  const document = requestDocument(), before = JSON.stringify(document), contexts = projectSectionContexts(document);
  assert.equal(contexts[0].documentSha256, documentationHash(document)); assert.equal(contexts[0].purpose, "requirements");
  const explicit = contexts[0].associations.find(a => a.kind === "route")!;
  assert.deepEqual(explicit.provenance, { origin: "explicit", associationId: "route-form" });
  const inferred = contexts[0].associations.find(a => a.kind === "ui-surface")!;
  assert.deepEqual(inferred.provenance, { origin: "inferred", findingId: "finding-1", context: { version: 1, analysisId: document.provenance.analysisId } });
  assert.equal(JSON.stringify(document), before);
  const corrupt = structuredClone(document); corrupt.context.find(a => a.origin === "finding")!.findingRef = "invented";
  assert.throws(() => projectSectionContexts(corrupt));
});
test("exact association and bounded text signals yield reproducible, fully explained scores", () => {
  const impact = transformationImpactFixture(), document = requestDocument();
  const query = candidateQuery(impact, [{ kind: "route", value: "/fixture" }]);
  const section = projectSectionContexts(document)[0], matched = matchSection(section, query)!;
  assert.ok(matched.reasons.some(r => r.kind === "association" && r.points === 40));
  assert.ok(matched.reasons.some(r => r.kind === "section-title" && r.tokens.includes("title")));
  assert.equal(matched.score, matched.reasons.reduce((sum, r) => sum + r.points, 0));
  assert.deepEqual(matchSection(section, query), matched);
  assert.equal(matchSection(section, { tokens: [], associations: [{ kind: "route", value: "/Fixture" }] }), null, "Association values match exactly");
  assert.ok(candidateQuery(impact).tokens.length <= 24);
  assert.deepEqual(textTokens("The TITLE title optional changed invoice"), ["invoice", "title"]);
});
test("unassociated text can match; generic single-word overlap and irrelevant content do not", () => {
  const document = requestDocument(); document.associations = []; document.context = document.context.filter(a => a.kind !== "route");
  const context = projectSectionContexts(document)[0];
  assert.ok(matchSection(context, { tokens: ["request", "title"], associations: [] }));
  assert.equal(matchSection(context, { tokens: ["request"], associations: [] }), null);
  assert.equal(matchSection(context, { tokens: ["billing", "refund", "invoice"], associations: [] }), null);
});
test("selection contract rejects inconsistent coverage, foreign/duplicate IDs and unexplained scores", () => {
  const document = requestDocument(), match = matchSection(projectSectionContexts(document)[0], candidateQuery(transformationImpactFixture()))!;
  const selection = { selectedDocumentIds: [document.id], matches: [match], coverage: "search-selected", broadFallbackUsed: false, reason: "deterministic-matches" };
  assert.ok(candidateSelectionSchema.safeParse(selection).success);
  for (const mutation of [
    { ...selection, broadFallbackUsed: true }, { ...selection, coverage: "complete" }, { ...selection, selectedDocumentIds: [] },
    { ...selection, selectedDocumentIds: [document.id, document.id] }, { ...selection, matches: [match, match] },
    { ...selection, matches: [{ ...match, score: match.score + 1 }] },
  ]) assert.equal(candidateSelectionSchema.safeParse(mutation).success, false);
  assert.ok(candidateSelectionSchema.safeParse({ selectedDocumentIds: [], matches: [], coverage: "incomplete", broadFallbackUsed: false, reason: "plausible-candidates-exceed-limit" }).success);
});
