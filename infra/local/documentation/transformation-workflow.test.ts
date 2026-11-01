import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { draftFixture } from "./draft-fixture";
import { transformationImpactFixture, transformationDecisionFixture, transformationEntryFixture } from "./transformation-fixtures";
import type { TransformationAuthorization } from "@/features/documentation/transformation/transformation-input";
import type { SupportUnit } from "@/features/documentation/transformation/transformation-validation";

test("ProductImpact → real planner → batched transformations → support → canonical v2, with zero writes", async t => {
  const docs = [draftFixture(), draftFixture(), draftFixture(), draftFixture(), draftFixture()];
  const impact = transformationImpactFixture();
  const decisions = [transformationDecisionFixture(docs[0].id, docs[0].sections[0].id), transformationDecisionFixture(docs[1].id, null, "add"),
    transformationDecisionFixture(docs[2].id, null, "add"), transformationDecisionFixture(null, null, "add"),
    transformationDecisionFixture(docs[3].id, null, "no-change"), transformationDecisionFixture(null, null, "unresolved"),
    transformationDecisionFixture(docs[4].id, docs[4].sections[0].id)];
  const load = createRequire(join(process.cwd(), "package.json")), databasePath = load.resolve("./src/integrations/database/documentation-drafts.ts");
  const queries: typeof import("@/integrations/database/documentation-drafts") = load(databasePath);
  const databaseModule = load.cache[databasePath]!, previous = databaseModule.exports;
  const writes = t.mock.fn(() => { throw new Error("No saves in transformation"); });
  const rows = docs.map(document => ({ id: document.id, document, savedAt: new Date() }));
  databaseModule.exports = { ...queries, searchDocumentationSections: async () => [], selectDocumentationDrafts: async () => rows,
    findDocumentationDraft: async (id: string) => rows.find(row => row.id === id) ?? null, insertDocumentationDraft: writes };
  const paths = ["documents/operations", "planning/documentation-impact-input", "planning/select-documentation-candidates", "planning/validate-documentation-impact-plan", "planning/plan-documentation-impact", "transformation/transform-documentation"].map(name => load.resolve(`./src/features/documentation/${name}.ts`));
  const cached = paths.map(path => load.cache[path]); paths.forEach(path => { delete load.cache[path]; });
  const old = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "fixture";
  t.after(() => { databaseModule.exports = previous; paths.forEach((path, i) => { if (cached[i]) load.cache[path] = cached[i]; else delete load.cache[path]; }); if (old === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = old; });
  let planning = 0, generation = 0, support = 0;
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    assert.equal(String(url), "https://inference.baseten.co/v1/chat/completions");
    const body = JSON.parse(String(init?.body)), input = JSON.parse(body.messages[1].content);
    let output: unknown;
    if (input.candidateCoverage) { planning++; output = { decisions: input.impact.assessment === "insufficient-evidence" ? [transformationDecisionFixture(null, null, "unresolved")] : decisions, uncertainties: [] }; }
    else if (input.units) { support++; output = { verdicts: input.units.map((unit: SupportUnit) => ({ unitId: unit.id,
      verdict: unit.text.includes("emails administrators") ? "unsupported" : "supported", reason: unit.text.includes("emails administrators") ? "No authorized claim establishes email." : "Within authorized evidence" })) }; }
    else {
      generation++; output = { entries: input.authorizations.map((auth: TransformationAuthorization) => {
        const entry = transformationEntryFixture(auth, input.documents, auth.target.documentId === docs[2].id);
        if (auth.target.documentId === docs[4].id && entry.change.kind === "replace-section") entry.change.section.content[0].markdown = "The system automatically emails administrators.";
        return entry;
      }) };
    }
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] });
  });
  const { planDocumentationImpact }: typeof import("@/features/documentation/planning/plan-documentation-impact") = load(paths.find(path => path.endsWith("/plan-documentation-impact.ts"))!);
  const { transformDocumentation }: typeof import("@/features/documentation/transformation/transform-documentation") = load(paths.find(path => path.endsWith("/transform-documentation.ts"))!);
  const { plan } = await planDocumentationImpact({ impact });
  const proposal = await transformDocumentation({ impact, plan });
  assert.equal(planning, 1); assert.equal(generation, 2); assert.equal(support, 1);
  assert.equal(proposal.results.length, 7); assert.equal(proposal.candidates.length, 3);
  assert.equal(proposal.results[2].materialization, "blocked"); assert.equal(proposal.results[2].reviewReady, true);
  assert.equal(proposal.results[4].generation, "not-required"); assert.equal(proposal.results[5].generation, "not-required");
  assert.equal(proposal.results[6].support, "unsupported");
  assert.ok(proposal.candidates.every(candidate => candidate.document.schemaVersion === 2));
  assert.ok(proposal.candidates.some(candidate => candidate.document.provenance.contexts.length === 2));
  assert.equal(writes.mock.callCount(), 0);
  const insufficient = { ...impact, assessment: "insufficient-evidence" as const };
  const unresolved = await planDocumentationImpact({ impact: insufficient });
  const unresolvedProposal = await transformDocumentation({ impact: insufficient, plan: unresolved.plan });
  assert.equal(unresolvedProposal.results[0].generation, "not-required");
  assert.equal(generation, 2); assert.equal(support, 1);
});
