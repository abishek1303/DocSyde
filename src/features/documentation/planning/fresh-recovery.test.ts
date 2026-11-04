import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { planDocumentationImpact } from "./plan-documentation-impact";
import { freshFallbackDecisions } from "./fresh-source-targets";
import { validateImpactDecisions } from "./validate-documentation-impact-plan";
import { transformationImpactFixture } from "../../../../infra/local/documentation/transformation-fixtures";
import type { ProductImpact, ProductRoute } from "@/features/sources/product-evidence";
function impact() {
  const value = transformationImpactFixture(4); value.assessment = "insufficient-evidence";
  value.provenance.source.base = value.provenance.source.head; value.provenance.source.limited = true;
  for (const source of value.provenance.sourceReferences) { source.finding.before = null; source.finding.after = null; }
  for (const claim of value.claims) { claim.before = null; claim.after = null; }
  for (const evidence of value.provenance.sourceEvidence) { evidence.side = "head"; evidence.commitId = value.provenance.source.head; }
  return value;
}
function routes(value: ProductImpact): ProductRoute[] { return [{ id: "screen-main", pathname: "/", sourcePaths: value.provenance.sourceEvidence.map(e => e.path), evidence: { label: "Requests", method: "spa-entry", commitId: value.provenance.source.head, sources: [{ path: "main.ts", line: 1, excerpt: "mount(App)" }], requiresConfirmation: false } }]; }
function provider(t: TestContext, action: "add" | "unresolved", bad = false) {
  const previous = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "fixture";
  t.after(() => { if (previous === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = previous; });
  return t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    assert.equal(url, "https://inference.baseten.co/v1/chat/completions");
    const body = JSON.parse(String(init?.body)); const input = JSON.parse(body.messages[1].content);
    assert.equal(input.objective, "fresh"); assert.equal(input.documents, undefined);
    const decisions = input.impact.claims.map((claim: {id: string}) => ({ action, documentId: null, sectionId: null, claimRefs: [bad ? "claim-6" : claim.id], reason: "Supported current behavior", updateIntent: "Document only cited current behavior." }));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ decisions, uncertainties: [] }) } }] });
  });
}
test("actual failure: global insufficient assessment does not reject four source-grounded fresh additions", async t => {
  const value = impact(), fetch = provider(t, "add");
  const result = await planDocumentationImpact({ impact: value, objective: "fresh", routes: routes(value) });
  assert.equal(result.plan.decisions.filter(d => d.action === "add").length, 4); assert.equal(fetch.mock.callCount(), 1);
  assert.throws(() => validateImpactDecisions(value, result.plan.decisions, []), /Uncertain ProductImpact/);
  validateImpactDecisions(value, result.plan.decisions, [], { fresh: true });
});
test("one corrective attempt then grounded fallback targets; no document prose or route invention", async t => {
  const value = impact(), fetch = provider(t, "unresolved");
  const { plan } = await planDocumentationImpact({ impact: value, objective: "fresh", routes: routes(value) });
  assert.equal(fetch.mock.callCount(), 2); assert.equal(plan.decisions.length, 4);
  assert.ok(plan.decisions.every(d => d.action === "add" && d.documentId === null && d.sectionId === null));
  assert.ok(plan.uncertainties.some(s => s.includes("corrective planning")));
  const secondBody = JSON.parse(String(fetch.mock.calls[1].arguments[1]?.body));
  assert.match(secondBody.messages[0].content, /CORRECTIVE FULL SCAN ATTEMPT/);
  assert.equal(plan.qualifications.assessment, "insufficient-evidence", "upstream qualifications remain intact");
});
test("no route proof means no fabricated fallback mapping", async t => {
  const value = impact(), fetch = provider(t, "unresolved");
  const { plan } = await planDocumentationImpact({ impact: value, objective: "fresh" });
  assert.equal(fetch.mock.callCount(), 2); assert.ok(plan.decisions.every(d => d.action === "unresolved"));
  for (const changed of [{ commitId: "f".repeat(40) }, { requiresConfirmation: true }]) {
    const route = routes(value)[0]; route.evidence = { ...route.evidence, ...changed };
    assert.deepEqual(freshFallbackDecisions(value, [route]), []);
  }
  const internal = impact(); internal.provenance.sourceReferences.forEach(s => { s.finding.kind = "internal-change"; });
  assert.deepEqual(freshFallbackDecisions(internal, routes(internal)), []);
  value.contradictions = [{ description: "Conflicting evidence", status: "unresolved", references: ["source-1", "visual:unverified"] }];
  assert.deepEqual(freshFallbackDecisions(value, routes(value)), []);
});
test("invalid planner claim references still reject without recovery", async t => {
  const value = impact(), fetch = provider(t, "add", true);
  await assert.rejects(planDocumentationImpact({ impact: value, objective: "fresh", routes: routes(value) }), /Unknown or duplicate/);
  assert.equal(fetch.mock.callCount(), 1);
});
