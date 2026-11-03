import assert from "node:assert/strict";
import { test } from "node:test";
import { selectCurrentStatePaths } from "./current-state-selection";
import { reconstructProductAnalysis } from "./product-change-evidence";
import { validateProductResult } from "./validate-product-result";
import { storedProductResult } from "./stored-product-result";
import type { ProductBundle } from "./product-change-analysis";

test("current-state selection discovers distinct workflows beyond onboarding within a fixed budget", () => {
  const tree = ["README.md", "package.json", ...Array.from({ length: 30 }, (_, i) => `src/features/area-${i}/actions.ts`), "node_modules/lib/main.ts", "src/features/sample.test.ts"];
  const paths = selectCurrentStatePaths(tree);
  assert.equal(paths.length, 16);
  assert.ok(paths.filter(path => path.includes("features/")).length > 6);
  assert.ok(!paths.some(path => /node_modules|\.test\./.test(path)));
  assert.deepEqual(selectCurrentStatePaths([...tree].reverse()), paths);
});

test("snapshot findings require pinned current evidence and cannot invent temporal changes", () => {
  const sha = "a".repeat(40);
  const bundle: ProductBundle = { mode: "current-state", repository: "https://github.com/example/product", base: sha, head: sha,
    inventory: [{ path: "src/actions.ts", previousPath: null, kind: "current-file" }],
    evidence: [{ id: "snapshot-1", path: "src/actions.ts", side: "head", commitId: sha, text: "export function save() {}", changed: false, status: "available" }], limited: true, notice: "One sampled file; other workflows unobserved." };
  const generated = { findings: [{ kind: "product-behavior", description: "Save is defined", before: null, after: null, support: "inferred", confidence: "low", confidenceReason: "Caller unobserved", assumptions: [], uncertainties: ["Caller unobserved"], citations: [{ evidenceId: "snapshot-1", startLine: 1, endLine: 1 }] }], uncertainties: ["Partial coverage"] };
  const analysis = reconstructProductAnalysis(generated, bundle);
  const result = { bundle, analysis, bytes: 100, status: "analyzed" };
  assert.equal(validateProductResult(result).bundle.mode, "current-state");
  assert.equal(storedProductResult.parse(result).bundle.mode, "current-state");
  assert.throws(() => reconstructProductAnalysis({ ...generated, findings: [{ ...generated.findings[0], before: "Old behavior" }] }, bundle));
  assert.throws(() => reconstructProductAnalysis({ ...generated, findings: [{ ...generated.findings[0], citations: [{ evidenceId: "advisory-understanding", startLine: 1, endLine: 1 }] }] }, bundle));
  assert.throws(() => validateProductResult({ ...result, bundle: { ...bundle, head: "b".repeat(40) } }));
  assert.throws(() => validateProductResult({ ...result, bundle: { ...bundle, evidence: [{ ...bundle.evidence[0], changed: true }] } }));
  assert.throws(() => validateProductResult({ ...result, bundle: { ...bundle, mode: undefined } }));
});
