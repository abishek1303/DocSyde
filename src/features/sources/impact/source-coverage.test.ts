import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { synthesizeProductImpact } from "./synthesize-product-impact";
import { isProductImpactCoverageError, validateSourceCoverage } from "./source-coverage";
import { validateProductImpact } from "./validate-product-impact";
import { ModelError } from "@/integrations/ai/structured-output";
import type { ProductImpact } from "./product-impact";
import type { ProductResult } from "../analysis/product-change-analysis";
import type { RuntimeVisualEvidence } from "../runtime/runtime-visual-evidence";

type Output = Omit<ProductImpact, "provenance">;
const captureId = "11111111-1111-4111-8111-111111111111";
const visual = `visual:${captureId}:observations:0`;
function source(): ProductResult {
  const texts = ["if (!name.trim()) return;\nawait addProject({ name: name.trim() });", "timer.current = setTimeout(() => setSearch(value), 300);"];
  return { status: "analyzed", bytes: 0, bundle: { mode: "current-state", repository: "https://github.com/example/product", base: "a".repeat(40), head: "a".repeat(40), limited: true, notice: "Pinned current-state excerpts; unobserved behavior is unknown.",
    inventory: texts.map((_, i) => ({ path: `view-${i}.tsx`, kind: "current-file", previousPath: null })),
    evidence: texts.map((text, i) => ({ id: `snapshot-${i}`, path: `view-${i}.tsx`, side: "head", commitId: "a".repeat(40), changed: false, status: "available", text })) },
    analysis: { assessment: "product-change", uncertainties: [], findings: texts.map((text, i) => ({ kind: "product-behavior", description: i ? "Search updates after a 300ms debounce." : "Project creation requires a nonempty trimmed name.", before: null, after: null, support: "directly-supported", confidence: "high", confidenceReason: "Direct source guard and timer.", citations: [{ evidenceId: `snapshot-${i}`, startLine: 1, endLine: text.split("\n").length, excerpt: text }], reachabilityEvidenceIds: [], assumptions: [], uncertainties: [] })) } };
}
function runtime(observation = "Projects 0. No projects."): RuntimeVisualEvidence {
  return { captureId, artifactKey: "22222222-2222-4222-8222-222222222222", requestedPathname: "/projects", finalPathname: "/projects", capturedAt: "2026-11-04T00:00:00.000Z", screenshotSha256: "c".repeat(64), vision: { model: "mock", elapsedMs: 1, data: { elements: [], observations: [observation], limitations: ["Single viewport; no creation or search performed."] } } };
}
function output(): Output {
  return { assessment: "product-change", summary: "Current project creation and search behavior.", claims: [{ kind: "workflow-change", description: "Project creation requires a nonempty trimmed name; search updates after 300ms.", references: ["source-1", "source-2"], before: null, after: null, confidence: "high", confidenceReason: "Source guard and timer.", uncertainties: [] }], sourceCoverage: [{ findingId: "source-1", status: "incorporated" }, { findingId: "source-2", status: "incorporated" }], contradictions: [], uncertainties: [] };
}
function provider(t: TestContext, result: unknown) {
  const previous = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "mock";
  t.after(() => { if (previous === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = previous; });
  return t.mock.method(globalThis, "fetch", async (url: unknown, options?: RequestInit) => {
    assert.equal(url, "https://inference.baseten.co/v1/chat/completions");
    const request = JSON.parse(String(options?.body));
    assert.match(request.messages[0].content, /Lack of visual confirmation.*NOT contradictory/);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }] });
  });
}
for (const withRuntime of [true, false]) test(`source requirements and debounce survive ${withRuntime ? "an empty Projects screen" : "no visual confirmation"}`, async t => {
  const fetch = provider(t, output()); const input = source();
  const { impact } = await synthesizeProductImpact({ source: input, runtime: withRuntime ? [runtime()] : [] });
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(impact.assessment, "product-change");
  assert.equal(impact.claims.length, 1, "several findings can map to one claim");
  assert.deepEqual(impact.claims[0].references, ["source-1", "source-2"]);
  assert.deepEqual(impact.provenance.sourceReferences.map(s => s.finding.citations), input.analysis!.findings.map(f => f.citations));
  assert.deepEqual(validateProductImpact(impact), impact);
  const historical = { ...impact }; delete historical.sourceCoverage;
  assert.deepEqual(validateProductImpact(historical), historical, "historical impacts without a ledger remain readable");
});
test("genuine source/runtime contradiction retains uncertainty and both evidence references", async t => {
  const value = output(); value.assessment = "insufficient-evidence";
  value.claims[0].references = ["source-2"]; value.claims[0].description = "Search updates after 300ms.";
  value.sourceCoverage![0] = { findingId: "source-1", status: "uncertain", reason: "contradiction", explanation: "Visible form says name is optional, conflicting with its source guard." };
  value.contradictions = [{ description: "Form says name is optional but source rejects empty name.", status: "unresolved", references: ["source-1", visual] }];
  provider(t, value); const { impact } = await synthesizeProductImpact({ source: source(), runtime: [runtime("Project name (optional)")] });
  assert.equal(impact.assessment, "insufficient-evidence"); assert.equal(impact.contradictions.length, 1);
  validateProductImpact(impact);
});
for (const kind of ["internal-change", "undetermined"] as const) test(`${kind} findings are accounted for without forcing documentation claims`, async t => {
  const input = source(); input.status = "insufficient-evidence"; input.analysis!.assessment = "insufficient-evidence";
  input.analysis!.findings.forEach(f => { f.kind = kind; f.support = kind === "undetermined" ? "inferred" : "directly-supported"; if (kind === "undetermined") f.uncertainties = ["Product behavior cannot be established from this excerpt."]; });
  const value = output(); value.assessment = "insufficient-evidence"; value.claims = [];
  value.sourceCoverage = [1, 2].map(i => ({ findingId: `source-${i}`, status: "excluded", reason: kind === "internal-change" ? "internal-only" : "unsupported", explanation: kind === "internal-change" ? "Implementation configuration, not user behavior." : "The finding does not establish product behavior." }));
  provider(t, value); const { impact } = await synthesizeProductImpact({ source: input });
  assert.deepEqual(impact.claims, []); validateProductImpact(impact);
});
for (const variant of ["missing", "duplicate", "unknown", "false-incorporation", "all-uncertain", "false-exclusion", "fake-contradiction"] as const) test(`${variant} coverage is rejected in one call, without semantic retry`, async t => {
  const value = output();
  if (variant === "missing") delete value.sourceCoverage;
  if (variant === "duplicate") value.sourceCoverage![1] = { findingId: "source-1", status: "incorporated" };
  if (variant === "unknown") value.sourceCoverage![1] = { findingId: "source-4", status: "incorporated" };
  if (variant === "false-incorporation") value.claims = [];
  if (["all-uncertain", "false-exclusion", "fake-contradiction"].includes(variant)) {
    value.claims = []; value.assessment = "insufficient-evidence";
    value.sourceCoverage = [1, 2].map(i => ({ findingId: `source-${i}`, status: variant === "false-exclusion" ? "excluded" : "uncertain", reason: variant === "false-exclusion" ? "unsupported" : variant === "fake-contradiction" ? "contradiction" : "partial-source", explanation: "Runtime did not exercise this behavior." }));
  }
  // Keep an independently valid visual-only impact, reproducing the historical loss case.
  if (!value.claims.length) { value.assessment = "insufficient-evidence"; value.claims = [{ ...output().claims[0], kind: "visual-observation", description: "Empty Projects screen.", references: [visual] }]; }
  const fetch = provider(t, value);
  await assert.rejects(synthesizeProductImpact({ source: source(), runtime: [runtime()] }), error => isProductImpactCoverageError(error));
  assert.equal(fetch.mock.callCount(), 1);
});
test("retained ledger tampering is rejected and explanations do not enter diagnostics", () => {
  const value = output(); value.sourceCoverage = [];
  assert.throws(() => validateSourceCoverage(value, source().analysis!.findings.map((finding, findingIndex) => ({ id: `source-${findingIndex + 1}`, findingIndex, finding }))), error => {
    assert.ok(error instanceof ModelError); assert.ok(!JSON.stringify(error.diagnostic).includes("view-")); return true;
  });
});

test("all genuinely contradicted findings may remain uncertain without fabricated behavior claims", async t => {
  const input = source(); input.analysis!.findings = [input.analysis!.findings[0]];
  const value = output(); value.assessment = "insufficient-evidence";
  value.claims = [{ ...value.claims[0], kind: "visual-observation", description: "Form says the name is optional.", references: [visual] }];
  value.sourceCoverage = [{ findingId: "source-1", status: "uncertain", reason: "contradiction", explanation: "Source requires name but captured form says optional; revision identity is unverified." }];
  value.contradictions = [{ description: "Required source guard conflicts with optional field label.", status: "unresolved", references: ["source-1", visual] }];
  provider(t, value);
  const { impact } = await synthesizeProductImpact({ source: input, runtime: [runtime("Project name (optional)")] });
  assert.equal(impact.assessment, "insufficient-evidence");
  assert.ok(impact.claims.every(claim => claim.kind === "visual-observation"));
  validateProductImpact(impact);
});
