import { test } from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/blocked-status.json";
import { validateWithDiagnostics } from "./analysis-diagnostics";
import { serializeProductEvidence, validateProductCitation } from "./product-change-evidence";
import { productChangeOutput, productChangeGenerationOutput, type ProductBundle } from "./product-change-analysis";
import { rejectionDiagnostic, debugHash } from "@/integrations/ai/invocation-debug";

const bundle = fixture.bundle as ProductBundle;
const analysis = productChangeOutput.parse(fixture.output);
const citation = analysis.findings[2].citations[0];

test("historical Blocked output is schema-valid but rejects its extra trailing space at the correct coordinate", async () => {
  const payload = serializeProductEvidence(bundle);
  await assert.rejects(validateWithDiagnostics(analysis, bundle, payload), error => {
    const diagnostic = rejectionDiagnostic(error, "grounding-rejection");
    assert.equal(diagnostic.validator, "source-analysis");
    assert.equal(diagnostic.code, "citation-range-mismatch");
    assert.equal(diagnostic.path, "findings[2].citations[0]");
    assert.equal(diagnostic.expectedSha256, debugHash(payload));
    const detail = JSON.parse(diagnostic.citation!.content);
    assert.deepEqual(detail.returnedRange, [6, 6]);
    assert.deepEqual(detail.allowedRange, [1, 9]);
    assert.deepEqual(detail.matchingRanges, []);
    assert.equal(detail.path, "src/client/components/issue-list.tsx");
    assert.ok(!diagnostic.citation!.content.includes(citation.excerpt));
    return true;
  });
  validateProductCitation({ ...citation, excerpt: citation.excerpt.slice(0, -1) }, bundle);
});

test("inclusive bounds, adjacent/off-by-one coordinates, and spans are checked against exact supplied lines", () => {
  const valid = { ...citation, excerpt: citation.excerpt.trimEnd() };
  validateProductCitation(valid, bundle);
  for (const changed of [
    { startLine: 5, endLine: 5 }, { startLine: 7, endLine: 7 },
    { startLine: 5, endLine: 6 }, { startLine: 6, endLine: 7 },
  ]) assert.throws(() => validateProductCitation({ ...valid, ...changed }, bundle), /citation-range-mismatch/);
  for (const changed of [{ startLine: 1, endLine: 10 }, { startLine: 7, endLine: 6 }]) {
    assert.throws(() => validateProductCitation({ ...valid, ...changed }, bundle), /invalid-line-range/);
  }
});

test("multi-hunk added/deleted lines use continuous evidence coordinates, not source/hunk coordinates", () => {
  const text = "@@ -10 +10 @@\n-old\n+blocked\n@@ -90 +90 @@\n-before\n+after";
  const evidence = { ...bundle.evidence[0], text };
  const input = { ...bundle, evidence: [evidence] };
  for (const [line, excerpt] of [[2, "-old"], [3, "+blocked"], [5, "-before"], [6, "+after"]] as const) {
    validateProductCitation({ evidenceId: evidence.id, startLine: line, endLine: line, excerpt }, input);
  }
  validateProductCitation({ evidenceId: evidence.id, startLine: 2, endLine: 3, excerpt: "-old\n+blocked" }, input);
  assert.throws(() => validateProductCitation({ evidenceId: evidence.id, startLine: 90, endLine: 90, excerpt: "+after" }, input), /invalid-line-range/);
  const projected = JSON.parse(serializeProductEvidence(input));
  assert.deepEqual(projected.evidence[0].lines[5], [6, "+after"]);
  // Partial supplied text is authoritative; unavailable/over-budget evidence has no range.
  assert.throws(() => validateProductCitation({ evidenceId: evidence.id, startLine: 6, endLine: 6, excerpt: "+after" }, { ...input, evidence: [{ ...evidence, text: text.split("\n").slice(0, 3).join("\n") }] }), /invalid-line-range/);
  assert.throws(() => validateProductCitation({ evidenceId: evidence.id, startLine: 1, endLine: 1, excerpt: "+after" }, { ...input, evidence: [{ ...evidence, text: null, status: "over-budget" }] }), /unavailable-evidence/);
});

test("line endings and trailing empty lines are not normalized between projection and validation", () => {
  const evidence = { ...bundle.evidence[0], text: "+blocked\r\n+done\r\n" };
  const input = { ...bundle, evidence: [evidence] };
  const projected = JSON.parse(serializeProductEvidence(input));
  assert.deepEqual(projected.evidence[0].lines, [[1, "+blocked\r"], [2, "+done\r"], [3, ""]]);
  validateProductCitation({ evidenceId: evidence.id, startLine: 1, endLine: 2, excerpt: "+blocked\r\n+done\r" }, input);
});

test("schema excludes zero/negative starts and evidence selection omits oversized patches without renumbering text", async () => {
  for (const startLine of [0, -1]) {
    const output = structuredClone(analysis); output.findings[2].citations[0].startLine = startLine;
    assert.equal(productChangeGenerationOutput.safeParse(output).success, false);
  }
  const { selectEvidence } = await import("../summary/summary-evidence");
  const commit = { commitId: bundle.base, message: "", author: null, committedAt: null };
  const selected = selectEvidence({ repository: { location: bundle.repository }, base: commit, head: { ...commit, commitId: bundle.head }, commits: [],
    files: [{ path: "large.ts", previousPath: null, kind: "modified", additions: 1, deletions: 1, patch: "+".repeat(12 * 1024 + 1) }] });
  assert.equal(selected.files[0].patch, null); assert.equal(selected.files[0].coverage, "over-budget"); assert.equal(selected.limited, true);
});
