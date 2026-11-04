import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { transformationImpactFixture, transformationPlanFixture, transformationDecisionFixture, transformationEntryFixture } from "../../../../infra/local/documentation/transformation-fixtures";
import { decisionResultSchema } from "./documentation-change-proposal";
import { transformationSource, authorizeTransformation } from "./transformation-input";
import { transformationRequest } from "./transformation-batches";
import { validateTransformationEntry } from "./transformation-validation";
import { discoveredAssociations } from "./route-associations";
import { rejectionDiagnostic } from "@/integrations/ai/invocation-debug";
import type { ProductRoute } from "@/features/sources/product-evidence";

function fixture() {
  const impact = transformationImpactFixture(2);
  // Reproduce decision-1 -> claim-2 -> source-1; IDs are not ordinal aliases.
  impact.claims.reverse();
  const plan = transformationPlanFixture(impact, [transformationDecisionFixture(null, null, "add", ["claim-2"]), transformationDecisionFixture(null, null, "add", ["claim-1"])]);
  const source = transformationSource(impact, randomUUID(), []);
  const routes: ProductRoute[] = [{ id: "home", pathname: "/", sourcePaths: [impact.provenance.sourceEvidence[0].path], evidence: {
    label: "Home", method: "file-page", commitId: impact.provenance.source.head, requiresConfirmation: false, sources: [{ path: "app/page.tsx", line: 1, excerpt: "Page" }],
  } }];
  const auth = plan.decisions.map((decision, index) => authorizeTransformation(impact, plan, decisionResultSchema.parse({
    decisionId: `decision-${index + 1}`, decision, generation: "pending", support: "not-required", reviewReady: false, saveCompatible: false,
    approval: "not-requested", materialization: "pending", issues: [], limitations: [], change: null, model: null, candidateId: null,
  }), undefined, source, discoveredAssociations(impact, plan, decision, routes)));
  return { auth, impact, plan, source, entry: transformationEntryFixture(auth[0], []) };
}

test("generation exposes exact selectable IDs and pairings without upstream reference namespaces", () => {
  const { auth, entry } = fixture(), original = structuredClone(auth);
  const request = transformationRequest(auth, []), context = JSON.parse(request.input);
  const first = context.authorizations[0];
  assert.deepEqual(first.allowedReferences, { factRefs: auth[0].facts.map(f => f.id), claimRefs: ["claim-2"], associations: ["home-1"] });
  assert.equal(first.facts[0].findingRef, undefined); assert.equal(first.claims[0].claim.references, undefined); assert.equal(first.evidenceRefs, undefined);
  assert.deepEqual(first.facts[0].claimRefs, ["claim-2"]);
  assert.equal(first.associations[0].requiresConfirmation, false);
  assert.deepEqual(first.associations[0].evidencePaths, ["app/page.tsx"]);
  assert.equal(context.authorizations[1].associations[0].requiresConfirmation, true, "unmatched route remains an unresolved choice");
  assert.deepEqual(auth, original, "trusted provenance and authority must remain unchanged");
  assert.deepEqual(validateTransformationEntry(entry, auth[0]), entry.change);
});

for (const category of ["factRefs", "claimRefs", "section-associations", "document-associations"] as const) {
  for (const reason of ["unknown-in-guide", "duplicate-in-array", "missing"] as const) test(`${category}: ${reason} is independently diagnosed`, () => {
    const { auth, entry } = fixture();
    assert.ok(entry.change.kind === "add-document");
    const section = entry.change.sections[0], block = section.content[0];
    const allowed = category === "factRefs" ? auth[0].facts[0].id : category === "claimRefs" ? "claim-2" : "home-1";
    const values = reason === "unknown-in-guide" ? [category === "claimRefs" ? "claim-1" : "PRIVATE_REJECTED_VALUE"] : reason === "duplicate-in-array" ? [allowed, allowed] : undefined;
    const target = category === "factRefs" || category === "claimRefs" ? block : category === "section-associations" ? section : entry.change;
    const key = category === "factRefs" || category === "claimRefs" ? category : "associations";
    if (values) Reflect.set(target, key, values); else Reflect.deleteProperty(target, key);
    assert.throws(() => validateTransformationEntry(entry, auth[0]), error => {
      const diagnostic = rejectionDiagnostic(error, "correspondence-rejection");
      assert.equal(diagnostic.code, "unauthorized-reference");
      assert.equal(diagnostic.reference?.category, category); assert.equal(diagnostic.reference?.reason, reason);
      assert.ok(!JSON.stringify(diagnostic).includes("PRIVATE"));
      return true;
    });
  });
}

test("another guide's fact and a pathname literal cannot substitute for authorized IDs", () => {
  const { auth, entry } = fixture(); assert.ok(entry.change.kind === "add-document");
  entry.change.sections[0].content[0].factRefs = [auth[1].facts[0].id];
  assert.throws(() => validateTransformationEntry(entry, auth[0]), error => rejectionDiagnostic(error, "correspondence-rejection").reference?.reason === "unknown-in-guide");
  entry.change.sections[0].content[0].factRefs = [auth[0].facts[0].id];
  entry.change.associations = ["/"];
  assert.throws(() => validateTransformationEntry(entry, auth[0]), error => rejectionDiagnostic(error, "correspondence-rejection").reference?.category === "document-associations");
  entry.change.associations = [];
  const change = validateTransformationEntry(entry, auth[0]);
  assert.ok(change.kind === "add-document"); assert.deepEqual(change.associations, [], "missing route stays unselected");
});

test("evidence reuse across sections and blocks is valid; duplicate IDs within one array are not", () => {
  const { auth, entry } = fixture(); assert.ok(entry.change.kind === "add-document");
  const section = entry.change.sections[0];
  section.content.push(structuredClone(section.content[0]));
  entry.change.sections.push(structuredClone(section));
  assert.doesNotThrow(() => validateTransformationEntry(entry, auth[0]));
});

test("decision and snapshot identity mismatches are distinct from references", () => {
  const { auth, entry } = fixture(); entry.target = { ...entry.target, snapshotSha256: "a".repeat(64) };
  assert.throws(() => validateTransformationEntry(entry, auth[0]), error => {
    const diagnostic = rejectionDiagnostic(error, "correspondence-rejection");
    assert.equal(diagnostic.code, "unauthorized-decision-target"); assert.deepEqual(diagnostic.reference, { category: "identity", reason: "mismatched" }); return true;
  });
});


test("malformed and empty fact references never become implicit authority", () => {
  for (const value of [[], "PRIVATE_VALUE", [null]]) {
    const { auth, entry } = fixture(); assert.ok(entry.change.kind === "add-document");
    Reflect.set(entry.change.sections[0].content[0], "factRefs", value);
    assert.throws(() => validateTransformationEntry(entry, auth[0]), error => {
      const diagnostic = rejectionDiagnostic(error, "correspondence-rejection");
      assert.equal(diagnostic.reference?.category, "factRefs");
      assert.equal(diagnostic.reference?.reason, Array.isArray(value) && !value.length ? "missing" : "malformed");
      return true;
    });
  }
});

test("authorized facts must still match the selected authorized claims", () => {
  const { impact, plan, source } = fixture();
  const decision = { ...plan.decisions[0], claimRefs: ["claim-1", "claim-2"] };
  const auth = authorizeTransformation(impact, plan, decisionResultSchema.parse({ decisionId: "decision-1", decision,
    generation: "pending", support: "not-required", reviewReady: false, saveCompatible: false, approval: "not-requested", materialization: "pending", issues: [], limitations: [], change: null, model: null, candidateId: null,
  }), undefined, source, []);
  const entry = transformationEntryFixture(auth, []); assert.ok(entry.change.kind === "add-document");
  entry.change.sections[0].content[0].claimRefs = ["claim-1"];
  entry.change.sections[0].content[0].factRefs = [auth.facts.find(fact => fact.claimRefs.includes("claim-2"))!.id];
  assert.throws(() => validateTransformationEntry(entry, auth), error => rejectionDiagnostic(error, "correspondence-rejection").reference?.reason === "fact-claim-mismatch");
});
