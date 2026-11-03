import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { productChangeGenerationOutput, productChangeOutput, type GeneratedProductAnalysis, type ProductBundle } from "./product-change-analysis";
import { reconstructProductAnalysis, validateProductAnalysis } from "./product-change-evidence";
import { storedProductResult } from "./stored-product-result";

const bundle: ProductBundle = {
  repository: "https://github.com/example/product", base: "a".repeat(40), head: "b".repeat(40),
  inventory: [{ path: "app.tsx", previousPath: null, kind: "modified" }], limited: false, notice: "Selected evidence",
  evidence: [{ id: "patch-f1", path: "app.tsx", side: "patch", commitId: null, text: "+renderGuidance();", status: "included", changed: true }],
};
function finding(kind: GeneratedProductAnalysis["findings"][number]["kind"]): GeneratedProductAnalysis["findings"][number] {
  return { kind, description: "Conditional guidance", before: null, after: "Guidance is rendered", support: "directly-supported", confidence: "high", confidenceReason: "Explicit call in changed entry point",
    citations: [{ evidenceId: "patch-f1", startLine: 1, endLine: 1 }], reachabilityEvidenceIds: kind === "capability-added" ? ["patch-f1"] : [], assumptions: [], uncertainties: [] };
}
for (const [kinds, limited, expected] of [
  [["internal-change"], false, "internal-only"],
  [["capability-added"], false, "product-change"],
  [["behavior-modified"], false, "product-change"],
  [["internal-change", "behavior-modified", "undetermined"], false, "product-change"],
  [["internal-change", "undetermined"], false, "insufficient-evidence"],
  [["internal-change"], true, "insufficient-evidence"],
  [["capability-added"], true, "product-change"],
  [["undetermined"], false, "insufficient-evidence"],
  [[], false, "insufficient-evidence"],
] as const) test(`derive ${expected}: ${kinds.join(",")} / limited=${limited}`, () => {
  const input = { findings: kinds.map(finding), uncertainties: [] };
  const canonical = reconstructProductAnalysis(input, { ...bundle, limited });
  assert.equal(canonical.assessment, expected);
  assert.equal(productChangeOutput.safeParse(canonical).success, true);
  validateProductAnalysis(canonical, { ...bundle, limited });
});

test("assessment cannot be generated; historical canonical artifacts and conflict guard remain unchanged", () => {
  const semantic = { findings: [finding("capability-added")], uncertainties: [] };
  const canonical = reconstructProductAnalysis(semantic, bundle);
  assert.equal(productChangeGenerationOutput.safeParse({ ...semantic, assessment: "internal-only" }).success, false);
  const schema = z.toJSONSchema(productChangeGenerationOutput);
  assert.deepEqual(Object.keys(schema.properties ?? {}), ["findings", "uncertainties"]);
  for (const kind of ["capability-added", "internal-change"] as const) {
    const historical = reconstructProductAnalysis({ findings: [finding(kind)], uncertainties: [] }, bundle);
    assert.ok(storedProductResult.safeParse({ bundle, bytes: 0, status: "analyzed", analysis: historical }).success);
  }
  const contradictory = { ...canonical, assessment: "internal-only" as const };
  assert.ok(productChangeOutput.safeParse(contradictory).success);
  assert.throws(() => validateProductAnalysis(contradictory, bundle), /internal-only-conflict/);
  assert.equal(storedProductResult.safeParse({ bundle, bytes: 0, status: "analyzed", analysis: contradictory }).success, false);
  const invalid = { ...semantic, findings: [{ ...semantic.findings[0], reachabilityEvidenceIds: [] }] };
  assert.throws(() => reconstructProductAnalysis(invalid, bundle), /missing-reachability-evidence/);
});
