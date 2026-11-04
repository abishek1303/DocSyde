import { test } from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/blocked-status.json";
import createProject from "./fixtures/create-project-citation.json";
import { PRODUCT_CITATION_EXCERPT_CHARACTERS } from "./product-change-limits";
import { validateProductResult } from "./validate-product-result";
import { productChangeGenerationOutput, productChangeOutput, type ProductBundle } from "./product-change-analysis";
import { reconstructProductAnalysis, serializeProductEvidence, validateProductAnalysis } from "./product-change-evidence";
import { validateWithDiagnostics } from "./analysis-diagnostics";
import { storedProductResult } from "./stored-product-result";
import { rejectionDiagnostic } from "@/integrations/ai/invocation-debug";

const bundle = fixture.bundle as ProductBundle;
function references() {
  return productChangeGenerationOutput.parse({ uncertainties: fixture.output.uncertainties, findings: fixture.output.findings.map(({ reachabilityEvidenceIds: _legacyReachability, ...f }) => {
    assert.ok(Array.isArray(_legacyReachability));
    return ({ ...f, kind: f.kind === "internal-change" ? "internal-change" : f.kind === "undetermined" ? "undetermined" : "product-behavior",
    citations: f.citations.map(({ evidenceId, startLine, endLine }) => ({ evidenceId, startLine, endLine })),
  });
  }) });
}
test("historical semantic references succeed and excerpts come only from canonical evidence", async () => {
  const output = references();
  const canonical = await validateWithDiagnostics(output, bundle, serializeProductEvidence(bundle), true);
  assert.equal(fixture.output.findings[2].citations[0].excerpt.endsWith("; "), true);
  assert.equal(canonical.findings[2].citations[0].excerpt.endsWith(";"), true);
  for (const f of canonical.findings) for (const c of f.citations) {
    const evidence = bundle.evidence.find(e => e.id === c.evidenceId)!;
    assert.equal(c.excerpt, evidence.text!.split("\n").slice(c.startLine - 1, c.endLine).join("\n"));
  }
  assert.equal(productChangeOutput.safeParse(canonical).success, true);
  assert.equal(storedProductResult.safeParse({ bundle, bytes: Buffer.byteLength(serializeProductEvidence(bundle)), status: "analyzed", analysis: canonical }).success, true);
  assert.ok(!JSON.stringify(output).includes('"excerpt"'));
  for (const excerpt of ["", "wrong", " ", "\t\n"]) {
    const injected = structuredClone(output); Object.assign(injected.findings[0].citations[0], { excerpt });
    assert.equal(productChangeGenerationOutput.safeParse(injected).success, false);
  }
});
test("unknown/unavailable references, fabricated fields, and invalid ranges still reject", async () => {
  for (const [change, code] of [
    [{ evidenceId: "invented" }, "unknown-evidence"],
    [{ startLine: 6, endLine: 5 }, "invalid-line-range"],
    [{ startLine: 1, endLine: 10 }, "invalid-line-range"],
  ] as const) {
    const output = references(); Object.assign(output.findings[2].citations[0], change);
    await assert.rejects(validateWithDiagnostics(output, bundle, serializeProductEvidence(bundle), true), error => {
      const diagnostic = rejectionDiagnostic(error, "grounding-rejection");
      assert.equal(diagnostic.code, code); assert.equal(diagnostic.path, "findings[2].citations[0]"); return true;
    });
  }
  for (const startLine of [0, -1, 1.5]) {
    const output = references(); output.findings[2].citations[0].startLine = startLine;
    assert.equal(productChangeGenerationOutput.safeParse(output).success, false);
  }
  const output = references(); Object.assign(output.findings[0].citations[0], { path: "fabricated.ts" });
  assert.equal(productChangeGenerationOutput.safeParse(output).success, false);
  for (const text of [null, "+partial"]) {
    const unavailable = { ...bundle, evidence: bundle.evidence.map(e => e.id === "patch-f3" ? { ...e, text } : e) };
    assert.throws(() => reconstructProductAnalysis(references(), unavailable), text === null ? /unavailable-evidence/ : /invalid-line-range/);
  }
});
test("multi-hunk additions/deletions retain inclusive evidence coordinates and line boundaries", () => {
  const text = "@@ -10 +10 @@\n-old\r\n+blocked\r\n@@ -90 +90 @@\n-before\n+after";
  const input = { ...bundle, evidence: [{ ...bundle.evidence[0], text }] };
  for (const [startLine, endLine] of [[2, 2], [3, 3], [2, 3], [5, 6]]) {
    const output = references(); output.findings = [{ ...output.findings[2], citations: [{ evidenceId: input.evidence[0].id, startLine, endLine }] }];
    const result = reconstructProductAnalysis(output, input);
    assert.equal(result.findings[0].citations[0].excerpt, text.split("\n").slice(startLine - 1, endLine).join("\n"));
  }
  const tooLong = { ...input, evidence: [{ ...input.evidence[0], text: "+".repeat(PRODUCT_CITATION_EXCERPT_CHARACTERS + 1) }] };
  const output = references(); output.findings = [{ ...output.findings[2], citations: [{ evidenceId: input.evidence[0].id, startLine: 1, endLine: 1 }] }];
  assert.throws(() => reconstructProductAnalysis(output, tooLong), /citation-excerpt-size/);
  assert.throws(() => reconstructProductAnalysis(output, { ...input, evidence: [{ ...input.evidence[0], text: "" }] }), /citation-excerpt-size/);
  assert.throws(() => reconstructProductAnalysis(output, { ...input, evidence: [input.evidence[0], input.evidence[0]] }), /duplicate-reference/);
});

test("reference reconstruction preserves changed-evidence and rejects removed generation fields", () => {
  const output = references();
  assert.throws(() => reconstructProductAnalysis(output, { ...bundle, evidence: bundle.evidence.map(e => ({ ...e, changed: false })) }), /missing-change-evidence/);
  assert.equal(productChangeGenerationOutput.safeParse({ ...output, findings: [{ ...output.findings[0], reachabilityEvidenceIds: ["invented"] }] }).success, false);
});


test("Full Scan 14a3b06a: exact pinned create-project lines 9–26 reconstruct the 608-character citation", () => {
  const input: ProductBundle = { mode: "current-state", repository: "https://github.com/abishek1303/docksyde-demo-app-test-subject",
    base: createProject.commitId, head: createProject.commitId, limited: true, notice: "Saved bounded source from run 14a3b06a",
    inventory: [{ path: createProject.path, previousPath: null, kind: "current-file" }],
    evidence: [{ id: "snapshot-15", path: createProject.path, commitId: createProject.commitId, text: createProject.text, side: "head", changed: false, status: "available" }],
  };
  const finding = { kind: "product-behavior", before: null, after: null,
    description: "Creating a project requires a non-empty name and defaults to planned status and no priority.",
    support: "directly-supported", confidence: "high", confidenceReason: "Pinned CreateProject state and submit handler.", assumptions: [], uncertainties: [],
    citations: [{ evidenceId: "snapshot-15", startLine: createProject.startLine, endLine: createProject.endLine }] };
  const canonical = reconstructProductAnalysis({ findings: [finding], uncertainties: [] }, input);
  assert.equal(canonical.findings[0].citations[0].excerpt.length, 608);
  assert.equal(productChangeOutput.safeParse(canonical).success, true);
  const result = { bundle: input, bytes: 0, status: "analyzed", analysis: canonical };
  assert.doesNotThrow(() => validateProductResult(result));
  assert.throws(() => validateProductResult({ ...result, bundle: { ...input, evidence: [{ ...input.evidence[0], commitId: "a".repeat(40) }] } }), /unpinned-evidence/);
  assert.throws(() => validateProductResult({ ...result, bundle: { ...input, inventory: [{ ...input.inventory[0], path: "invented.ts" }] } }), /invalid-current-state-bundle/);
});

test("canonical citations accept the new boundary without treating length as semantic support", () => {
  for (const length of [601, 608, PRODUCT_CITATION_EXCERPT_CHARACTERS]) {
    const input = { ...bundle, evidence: [{ ...bundle.evidence[0], text: "+".repeat(length) }] };
    const finding = { ...references().findings[2], citations: [{ evidenceId: input.evidence[0].id, startLine: 1, endLine: 1 }] };
    const result = reconstructProductAnalysis({ findings: [finding], uncertainties: [] }, input);
    assert.equal(result.findings[0].citations[0].excerpt.length, length);
    assert.equal(productChangeOutput.safeParse(result).success, true);
    const tooLong = structuredClone(result); tooLong.findings[0].citations[0].excerpt = "+".repeat(PRODUCT_CITATION_EXCERPT_CHARACTERS + 1);
    assert.equal(productChangeOutput.safeParse(tooLong).success, false);
    assert.throws(() => reconstructProductAnalysis({ findings: [{ ...finding, support: "inferred", assumptions: [], uncertainties: [] }], uncertainties: [] }, input), /unqualified-inference/);
    const forged = structuredClone(result); forged.findings[0].citations[0].excerpt = "invented";
    assert.throws(() => validateProductAnalysis(forged, input), /citation-range-mismatch/);
  }
});

test("size-only rejection retains independent findings with explicit gaps, never truncating evidence", () => {
  const input = { ...bundle, evidence: [{ ...bundle.evidence[0], text: "+required\n" + "+".repeat(PRODUCT_CITATION_EXCERPT_CHARACTERS + 1) }] };
  const valid = { ...references().findings[2], citations: [{ evidenceId: input.evidence[0].id, startLine: 1, endLine: 1 }] };
  const oversized = { ...valid, citations: [{ ...valid.citations[0], startLine: 2, endLine: 2 }] };
  const result = reconstructProductAnalysis({ findings: [valid, oversized], uncertainties: ["Other files uninspected"] }, input);
  assert.equal(result.findings.length, 1); assert.equal(result.findings[0].citations[0].excerpt, "+required");
  assert.match(result.uncertainties[1], /Finding 2 omitted.*2000.*unverified/);
  assert.equal(productChangeOutput.safeParse(result).success, true);
  const partialInternal = reconstructProductAnalysis({ findings: [{ ...valid, kind: "internal-change" }, oversized], uncertainties: [] }, { ...input, limited: false });
  assert.equal(partialInternal.assessment, "insufficient-evidence", "an omitted product finding cannot establish internal-only coverage");
  assert.throws(() => reconstructProductAnalysis({ findings: [oversized], uncertainties: [] }, input), /citation-excerpt-size/);
  assert.throws(() => reconstructProductAnalysis({ findings: [valid, oversized], uncertainties: Array(4).fill("Existing gap") }, input), /citation-excerpt-size/, "never discard existing gaps to fit partial results");
  assert.throws(() => reconstructProductAnalysis({ findings: [valid, { ...oversized, citations: [{ ...oversized.citations[0], evidenceId: "unknown" }] }], uncertainties: [] }, input), /unknown-evidence/);
});
