import assert from "node:assert/strict";
import { test } from "node:test";
import fixture from "./fixtures/blocked-impact.json";
import { productImpactOutputSchema, type ProductImpact } from "./product-impact";
import { storedProductResult } from "../analysis/stored-product-result";
import { productImpactIRSchema, resolveProductImpactClaimIR, type ProductImpactIR } from "./product-impact-ir";

const source = storedProductResult.parse(fixture.source);
const sources = source.analysis!.findings.map((finding, findingIndex) => ({ id: `source-${findingIndex + 1}`, findingIndex, finding }));
function resolveProductImpactIR(raw: unknown, references: ProductImpact["provenance"]["sourceReferences"], currentState: boolean) {
  const ir = productImpactIRSchema.parse(raw);
  return productImpactOutputSchema.parse({ ...ir, claims: ir.claims.map(claim => resolveProductImpactClaimIR(claim, references, currentState)) });
}

const reply: ProductImpactIR = { assessment: "product-change", summary: "Issues support a Blocked state.",
  claims: [{ kind: "ui-change", description: "Users can choose Blocked when creating an issue.", confidence: "high", confidenceReason: "Explicit selector option.",
    beforeRef: "source-1", afterRef: "source-1", references: ["source-1"], uncertainties: ["Runtime revision is unverified."] }],
  contradictions: [], uncertainties: [] };

test("compact impact reconstructs exact temporal facts and preserves short judgments and qualifications", () => {
  const result = resolveProductImpactIR(reply, sources, false);
  assert.equal(result.claims[0].before, sources[0].finding.before);
  assert.equal(result.claims[0].after, sources[0].finding.after);
  assert.equal(result.claims[0].description, reply.claims[0].description);
  assert.deepEqual(result.claims[0].uncertainties, reply.claims[0].uncertainties);
  assert.ok(!Object.hasOwn(result.claims[0], "beforeRef"));
  assert.ok(!Object.hasOwn(result, "provenance"), "Provenance is attached by synthesis after grounding.");
});

test("unknown, mixed, uncited, unavailable, visual and current-state temporal references reject", () => {
  const variants = [
    { beforeRef: "source-4", references: ["source-1"] },
    { afterRef: "source-2", references: ["source-1", "source-2"] },
    { beforeRef: "source-2", afterRef: "source-2", references: ["source-2"] },
    { kind: "visual-observation" as const },
  ];
  for (const mutation of variants) {
    const changed = structuredClone(reply); Object.assign(changed.claims[0], mutation);
    assert.throws(() => resolveProductImpactIR(changed, sources.slice(0, 1), false), /unsupported-temporal-values/);
  }
  assert.throws(() => resolveProductImpactIR(reply, sources, true), /unsupported-temporal-values/);
  const unavailable = structuredClone(sources); unavailable[0].finding.after = null;
  assert.throws(() => resolveProductImpactIR(reply, unavailable, false), /unsupported-temporal-values/);
});

test("v3 wire format rejects copied temporal prose, oversized prose, and missing qualification arrays", () => {
  const invalid = [
    { ...reply, provenance: {} },
    { ...reply, claims: [{ ...reply.claims[0], before: "Copied text" }] },
    { ...reply, claims: [{ ...reply.claims[0], description: "x".repeat(501) }] },
    { ...reply, claims: [{ ...reply.claims[0], confidenceReason: "x".repeat(121) }] },
    { ...reply, uncertainties: undefined },
    { ...reply, claims: [{ ...reply.claims[0], beforeRef: "source-99" }] },
  ];
  for (const value of invalid) assert.equal(productImpactIRSchema.safeParse(value).success, false);
});

test("maximal compact prose stays bounded and temporal references avoid repeated 400-character facts", () => {
  const maximal = productImpactIRSchema.parse({ ...reply, summary: "x".repeat(300),
    claims: Array.from({ length: 6 }, () => ({ ...reply.claims[0], description: "x".repeat(500), confidenceReason: "x".repeat(120),
      uncertainties: Array(4).fill("x".repeat(160)), references: Array(6).fill("r".repeat(120)) })),
    contradictions: Array.from({ length: 4 }, () => ({ description: "x".repeat(240), status: "unresolved", references: Array(6).fill("r".repeat(120)) })),
    uncertainties: Array(6).fill("x".repeat(160)),
  });
  assert.ok(Buffer.byteLength(JSON.stringify(maximal)) < 20_000);
  const original = { before: "x".repeat(400), after: "y".repeat(400) };
  const compact = { beforeRef: "source-1", afterRef: "source-1" };
  assert.ok(JSON.stringify(compact).length < JSON.stringify(original).length / 10);
});


test("description brevity is a target; canonical-valid prose above 240 characters survives unchanged", () => {
  for (const length of [241, 400, 500]) {
    const value = structuredClone(reply); value.claims[0].description = "x".repeat(length);
    const result = resolveProductImpactIR(value, sources, false);
    assert.equal(result.claims[0].description, value.claims[0].description);
  }
  const tooLong = structuredClone(reply); tooLong.claims[0].description = "x".repeat(501);
  assert.throws(() => resolveProductImpactIR(tooLong, sources, false));
});
