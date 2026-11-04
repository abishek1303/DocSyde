import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSourceOutputShape, sourceShapeCorrection } from "./source-output-shape";
import { productChangeGenerationOutput } from "@/features/sources/analysis/product-change-analysis";
import { validateWithDiagnostics } from "@/features/sources/analysis/analysis-diagnostics";
import { ModelError } from "./structured-output";
import { createRequire } from "node:module";
import { join } from "node:path";
const load = createRequire(join(process.cwd(), "package.json"));

const finding = { kind: "product-behavior", description: "Requests require a title", before: "Optional", after: "Required",
  support: "directly-supported", confidence: "medium", confidenceReason: "Validation in source",
  citations: [{ evidenceId: "p1", startLine: 1, endLine: 1 }], assumptions: [], uncertainties: [] };
const output = () => ({ findings: [{ ...finding, audience: "Agents", surface: "Request form" }], uncertainties: [] });

test("observed four-finding audience/surface arrays normalize losslessly before strict validation", () => {
  const raw = { ...output(), findings: Array.from({ length: 4 }, () => ({ ...finding, audience: ["Agents"], surface: ["Request form"] })) };
  const before = JSON.stringify(raw);
  const normalized = normalizeSourceOutputShape("source-analysis", raw);
  const parsed = productChangeGenerationOutput.parse(normalized);
  assert.equal(parsed.findings.length, 4);
  for (const item of parsed.findings) { assert.equal(item.audience, "Agents"); assert.equal(item.surface, "Request form"); assert.deepEqual(item.citations, finding.citations); }
  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(normalizeSourceOutputShape("source-analysis", output()), output());
  assert.equal(normalizeSourceOutputShape("documentation-planning", raw), raw);
});

test("ambiguous or invalid shapes are not silently coerced; mixed evidence errors cannot recover", () => {
  for (const audience of [[], ["A", "B"], null, 12, [12], ["x".repeat(201)]]) {
    const raw = { ...output(), findings: [{ ...finding, audience }] };
    const normalized = normalizeSourceOutputShape("source-analysis", raw);
    assert.deepEqual(normalized, raw);
    assert.equal(productChangeGenerationOutput.safeParse(normalized).success, false);
  }
  const invalid = { ...output(), findings: [{ ...finding, audience: ["A", "B"], citations: [{ ...finding.citations[0], evidenceId: 12 }] }] };
  assert.equal(sourceShapeCorrection("source-analysis", productChangeGenerationOutput, invalid), undefined);
});

for (const scenario of ["normalized", "repaired", "exhausted", "evidence", "semantic"] as const) test(`source shape recovery: ${scenario}`, async t => {
  const databasePath = load.resolve("./src/integrations/database/ai-model-invocations.ts");
  const database = load(databasePath), original = load.cache[databasePath]!.exports;
  const logs: unknown[] = [];
  load.cache[databasePath]!.exports = { ...database, insertAiModelInvocation: async () => {}, updateAiModelInvocation: async (_id: string, row: unknown) => { logs.push(row); } };
  const paths = ["./src/integrations/ai/invocation-log.ts", "./src/integrations/ai/generate-structured.ts"].map(path => load.resolve(path));
  const cached = paths.map(path => [path, load.cache[path]] as const); paths.forEach(path => { delete load.cache[path]; });
  t.after(() => { load.cache[databasePath]!.exports = original; for (const [path, entry] of cached) { if (entry) load.cache[path] = entry; else delete load.cache[path]; } });
  const { generateStructured }: typeof import("./generate-structured") = load(paths[1]);
  const priorMode = process.env.DEMO_RELIABILITY_MODE; process.env.DEMO_RELIABILITY_MODE = "true";
  t.after(() => { if (priorMode === undefined) delete process.env.DEMO_RELIABILITY_MODE; else process.env.DEMO_RELIABILITY_MODE = priorMode; });
  const prior = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "test";
  t.after(() => { if (prior === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = prior; });
  let calls = 0;
  const fetch = t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    calls++;
    const request = JSON.parse(String(init?.body));
    if (calls === 2) {
      assert.match(request.messages[0].content, /Correct findings\[\]\.audience/);
      assert.ok(!request.messages[0].content.includes("PRIVATE_ROLE"));
    }
    const raw = scenario === "repaired" && calls === 2 ? output() : { ...output(), findings: [{ ...finding,
      audience: scenario === "normalized" ? ["Agents"] : ["PRIVATE_ROLE", "Other"],
      surface: ["Request form"],
      ...(scenario === "evidence" ? { citations: [{ ...finding.citations[0], evidenceId: 12 }] } : {}) }] };
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(raw) } }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });
  });
  const options = { instructions: "Analyze the supplied source", input: "source evidence", schema: productChangeGenerationOutput,
    invocation: { stage: "standalone", operation: "source-analysis" } };
  if (scenario === "semantic") {
    // A syntactically valid but unsupported citation must reach the original
    // semantic validator, never be repaired by field-shape normalization.
    fetch.mock.mockImplementation(async () => { calls++; return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output()) } }] }); });
    await assert.rejects(generateStructured({ ...options, validate: generated => validateWithDiagnostics(generated.data, {
      repository: "https://github.com/example/app", base: "a".repeat(40), head: "b".repeat(40), inventory: [], limited: false, notice: "fixture",
      evidence: [{ id: "real-evidence", path: "form.ts", side: "patch", commitId: null, text: "+required", status: "included", changed: true }],
    }, "fixture", true) }));
    assert.equal(calls, 1);
  } else if (scenario === "normalized" || scenario === "repaired") {
    const result = await generateStructured(options);
    assert.equal(result.data.findings[0].audience, "Agents");
    assert.equal(result.metadata?.attempt, scenario === "normalized" ? 1 : 2);
    assert.equal(result.metadata?.usage?.total_tokens, 30);
  } else {
    await assert.rejects(generateStructured(options), error => {
      assert.ok(error instanceof ModelError); assert.equal(error.code, "schema-mismatch");
      assert.equal(error.diagnostic?.attempt, scenario === "exhausted" ? 2 : 1); return true;
    });
  }
  assert.equal(calls, scenario === "repaired" || scenario === "exhausted" ? 2 : 1);
  assert.ok(logs.length >= calls);
  if (scenario === "repaired" || scenario === "exhausted") {
    assert.ok(logs.some(row => JSON.stringify(row).includes('"source-shape"')));
    assert.ok(!JSON.stringify(logs).includes("PRIVATE_ROLE"));
  }
});

test("source sampling defaults only use existing verified provider capabilities", async t => {
  const { resolveInference } = await import("./operation-policy");
  const prior = process.env.BASETEN_MODEL;
  t.after(() => { if (prior === undefined) delete process.env.BASETEN_MODEL; else process.env.BASETEN_MODEL = prior; });
  process.env.BASETEN_MODEL = "meta-models/muse-spark-open";
  assert.equal(resolveInference("baseten", "source-analysis").temperature, 0);
  assert.equal(resolveInference("baseten", "source-analysis", undefined, { temperature: 0.3 }).temperature, 0.3);
  process.env.BASETEN_MODEL = "meta-models/muse-spark-open-1026";
  assert.equal(resolveInference("baseten", "source-analysis").temperature, undefined);
});
