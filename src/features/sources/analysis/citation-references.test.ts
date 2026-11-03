import { test } from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/blocked-status.json";
import { productChangeGenerationOutput, productChangeOutput, type ProductBundle } from "./product-change-analysis";
import { reconstructProductAnalysis, serializeProductEvidence } from "./product-change-evidence";
import { validateWithDiagnostics } from "./analysis-diagnostics";
import { storedProductResult } from "./stored-product-result";
import { rejectionDiagnostic } from "@/integrations/ai/invocation-debug";

const bundle = fixture.bundle as ProductBundle;
function references() {
  return productChangeGenerationOutput.parse({ uncertainties: fixture.output.uncertainties, findings: fixture.output.findings.map(f => ({ ...f,
    citations: f.citations.map(({ evidenceId, startLine, endLine }) => ({ evidenceId, startLine, endLine })),
  })) });
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
  const tooLong = { ...input, evidence: [{ ...input.evidence[0], text: "+".repeat(601) }] };
  const output = references(); output.findings = [{ ...output.findings[2], citations: [{ evidenceId: input.evidence[0].id, startLine: 1, endLine: 1 }] }];
  assert.throws(() => reconstructProductAnalysis(output, tooLong), /citation-excerpt-size/);
  assert.throws(() => reconstructProductAnalysis(output, { ...input, evidence: [{ ...input.evidence[0], text: "" }] }), /citation-excerpt-size/);
  assert.throws(() => reconstructProductAnalysis(output, { ...input, evidence: [input.evidence[0], input.evidence[0]] }), /duplicate-reference/);
});

test("reference reconstruction preserves changed-evidence and capability-reachability requirements", () => {
  const output = references();
  assert.throws(() => reconstructProductAnalysis(output, { ...bundle, evidence: bundle.evidence.map(e => ({ ...e, changed: false })) }), /missing-change-evidence/);
  output.findings[0].kind = "capability-added"; output.findings[0].reachabilityEvidenceIds = ["invented"];
  assert.throws(() => reconstructProductAnalysis(output, bundle), /missing-reachability-evidence/);
});
