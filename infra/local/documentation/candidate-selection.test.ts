import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { getDatabase, closeDatabase } from "@/integrations/database/client";
import { searchDocumentationSections } from "@/integrations/database/documentation-drafts";
import { matchSection, type CandidateQuery } from "@/features/documentation/candidate-selection";
import { documentationDrafts } from "@/integrations/database/schema";
import { draftFixture } from "./draft-fixture";
import { transformationImpactFixture, transformationDecisionFixture } from "./transformation-fixtures";
import { selectDocumentationCandidates } from "@/features/documentation/select-documentation-candidates";
import { transformDocumentation } from "@/features/documentation/transform-documentation";
import { planDocumentationImpact } from "@/features/documentation/plan-documentation-impact";
import { validateDocumentationImpactPlan } from "@/features/documentation/validate-documentation-impact-plan";
import { documentationHash } from "@/features/documentation/document-identity";
import { projectSectionContexts } from "@/features/documentation/section-context";
import { reviewProposalFixture } from "./review-fixtures";

test("PostgreSQL section selector narrows candidates before one grounded planner call", { timeout: 30_000 }, async t => {
  const repository = `https://github.com/selector-test/${randomUUID()}`, impact = transformationImpactFixture(); impact.provenance.source.repository = repository;
  const oldKey = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "fixture";
  const ids: string[] = [];
  const corpus: ReturnType<typeof draftFixture>[] = [];
  const add = async (title: string, first = "Billing invoices", body = "Invoice payment details.") => {
    const document = draftFixture(); document.provenance.repository = repository; document.title = title;
    document.sections[0].title = first; document.sections[0].content.forEach(b => { b.markdown = body; }); document.sections[1].title = "Archive";
    await getDatabase().insert(documentationDrafts).values({ id: document.id, document }); ids.push(document.id); corpus.push(document); return document;
  };
  t.after(async () => { if (ids.length) await getDatabase().delete(documentationDrafts).where(inArray(documentationDrafts.id, ids)); await closeDatabase(); if (oldKey === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = oldKey; });
  let output: unknown, payload: { candidateCoverage: string; documents: { id: string; sections: { id: string }[] }[] } | undefined;
  const fetch = t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    assert.equal(String(url), "https://inference.baseten.co/v1/chat/completions");
    payload = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] });
  });
  const target = await add("Request guide", "Title validation", "A request title is required.");
  for (let i = 0; i < 11; i++) await add(`Billing handbook ${i}`);
  await t.test("more than ten corpus documents narrow to the correct section and full target outline", async () => {
    const { selection, documents } = await selectDocumentationCandidates(impact);
    assert.deepEqual(selection.selectedDocumentIds, [target.id]); assert.equal(selection.coverage, "search-selected"); assert.equal(selection.broadFallbackUsed, false);
    assert.deepEqual(selection.matches.map(m => m.sectionId), [target.sections[0].id]); assert.equal(documents[0].sections.length, target.sections.length);
    assert.equal(selection.matches[0].documentSha256, documentationHash(target));
    output = { decisions: [transformationDecisionFixture(target.id, target.sections[0].id)], uncertainties: [] };
    const result = await planDocumentationImpact({ impact }); assert.equal(fetch.mock.callCount(), 1);
    assert.equal(result.plan.decisions[0].sectionId, target.sections[0].id); assert.equal(payload?.candidateCoverage, "search-selected");
    assert.deepEqual(payload?.documents.map(d => d.id), [target.id]); assert.deepEqual(result.plan.candidateSelection, selection);
    assert.ok(validateDocumentationImpactPlan(impact, result.plan));
    const mismatched = structuredClone(result.plan); mismatched.candidateSelection!.matches[0].documentSha256 = "0".repeat(64);
    const before = fetch.mock.callCount(), rejected = await transformDocumentation({ impact, plan: mismatched });
    assert.equal(rejected.candidates.length, 0); assert.equal(rejected.results[0].reviewReady, false); assert.equal(fetch.mock.callCount(), before, "Snapshot mismatch never triggers generation");
  });
  await t.test("association-only matching is exact and cannot become factual support", async () => {
    const context = [{ id: "feature-request", kind: "route" as const, value: "/fixture", origin: "operator" as const }];
    const selection = await selectDocumentationCandidates(impact, { context });
    assert.equal(selection.selection.coverage, "incomplete", "Every plausible route match is retained rather than picking the highest ten");
    const visualOnly = structuredClone(impact); visualOnly.assessment = "insufficient-evidence";
    output = { decisions: [transformationDecisionFixture(target.id, target.sections[0].id)], uncertainties: [] };
    await assert.rejects(planDocumentationImpact({ impact: visualOnly }), /Uncertain ProductImpact/);
  });
  await t.test("identical historical snapshots and plausible ties stay distinct and unresolved", async () => {
    const second = await add("Request guide", "Title validation", "A request title is required.");
    const selected = await selectDocumentationCandidates(impact); assert.deepEqual(selected.selection.selectedDocumentIds, [target.id, second.id].sort());
    assert.equal(selected.selection.matches[0].score, selected.selection.matches[1].score);
    output = { decisions: [{ ...transformationDecisionFixture(null, null, "unresolved"), reason: "Both immutable snapshots are equally plausible; no authority identifies the target." }], uncertainties: [] };
    const result = await planDocumentationImpact({ impact }); assert.equal(result.plan.decisions[0].action, "unresolved");
    assert.ok(selected.selection.matches.every(m => m.sectionId === target.sections[0].id || m.sectionId === second.sections[0].id));
  });
  await t.test("empty search uses unchanged broad-loading completeness checks", async () => {
    const unrelated = structuredClone(impact); unrelated.claims[0].description = "Zebra migration scheduling"; unrelated.claims[0].before = null; unrelated.claims[0].after = null;
    await assert.rejects(selectDocumentationCandidates(unrelated), /candidates are incomplete/);
    const small = `https://github.com/selector-test/${randomUUID()}`, document = draftFixture(); document.provenance.repository = small;
    await getDatabase().insert(documentationDrafts).values({ id: document.id, document }); ids.push(document.id);
    unrelated.provenance.source.repository = small;
    const fallback = await selectDocumentationCandidates(unrelated);
    assert.equal(fallback.selection.broadFallbackUsed, true); assert.equal(fallback.selection.coverage, "complete"); assert.deepEqual(fallback.selection.selectedDocumentIds, [document.id]);
  });
  await t.test("v2 inferred labels retain the exact historical evidence context", () => {
    const baseline = structuredClone(target); baseline.associations.push("surface-form");
    const candidate = reviewProposalFixture(baseline, false).candidates[0].document;
    const contexts = projectSectionContexts(candidate), inferred = contexts.flatMap(c => c.associations).find(a => a.provenance.origin === "inferred");
    assert.notEqual(candidate.id, target.id); assert.equal(contexts[0].sectionId, target.sections[0].id);
    assert.ok(inferred); if (inferred.provenance.origin === "inferred") assert.equal(inferred.provenance.context.version, 2);
  });
  await t.test("SQL eligibility exactly matches local explanation rules for metadata and text", async () => {
    await add("Unassociated guide", "Details", "Request, TITLE / validation; request title.");
    for (const query of [
      { tokens: ["request", "title", "validation"], associations: [] },
      { tokens: ["invoice", "payment", "details"], associations: [] },
      { tokens: [], associations: [{ kind: "route", value: "/fixture" }] },
      { tokens: [], associations: [{ kind: "route", value: "/Fixture" }] },
    ] satisfies CandidateQuery[]) {
      const expected = corpus.flatMap(projectSectionContexts).filter(c => matchSection(c, query)).map(c => ({ documentId: c.documentId, sectionId: c.sectionId }));
      const actual = await searchDocumentationSections(repository, query, 41);
      const sort = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).sort();
      assert.deepEqual(sort(actual), sort(expected));
    }
  });
  await t.test("overflow reports typed incomplete selection and never invokes another model", async () => {
    for (let i = 0; i < 9; i++) await add(`Request guide ${i}`, "Title validation", "A request title is required.");
    const selected = await selectDocumentationCandidates(impact); assert.equal(selected.selection.coverage, "incomplete"); assert.deepEqual(selected.selection.selectedDocumentIds, []);
    const before = fetch.mock.callCount(); await assert.rejects(planDocumentationImpact({ impact }), /selection is incomplete/); assert.equal(fetch.mock.callCount(), before);
  });
});
