import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fixture from "./fixtures/blocked-impact.json";
import { productImpactOutputSchema } from "./product-impact";
import { synthesizeProductImpact } from "./synthesize-product-impact";
import { parseStructuredOutput, ModelError } from "@/integrations/ai/structured-output";
import { storedProductResult } from "../analysis/stored-product-result";
import { runtimeInspectionContextSchema } from "../runtime/runtime-inspection-context";
import { runtimeVisualEvidenceList, RUNTIME_REVISION_WARNING } from "../runtime/runtime-visual-evidence";

const valid = productImpactOutputSchema.parse({ assessment: "product-change", summary: "Issues can now be marked Blocked and appear in a dedicated group.",
  claims: [{ description: "Issue Detail now offers Blocked status.", kind: "ui-change", confidence: "high", confidenceReason: "Explicit source selector change.",
    before: null, after: null, uncertainties: [], references: ["source-2"] }], contradictions: [], uncertainties: [] });
const schema = productImpactOutputSchema;
const invalid = [
  { impact: valid }, { result: valid }, { analysis: valid },
  { summary: valid.summary }, // Summary is required, not forbidden; a summary-only wrapper is incomplete.
  { ...valid, title: "Blocked" }, { ...valid, analysis: {} },
  { ...valid, source: fixture.source, provenance: {} },
  { ...valid, result: {}, metadata: {}, rationale: "outside claims" },
  { ...valid, claims: [{ ...valid.claims[0], analysis: {} }] },
];
test("product-impact exact root is strict at every object level; summary is a required semantic field", () => {
  assert.deepEqual(Object.keys(schema.shape), ["assessment", "summary", "claims", "contradictions", "uncertainties"]);
  assert.deepEqual(parseStructuredOutput(JSON.stringify(valid), schema), valid);
  for (const output of invalid) assert.throws(() => parseStructuredOutput(JSON.stringify(output), schema, true), /schema-mismatch/);
});
test("safe shape diagnostics include only fixed structural key names/counts and hashes, never values or arbitrary keys", () => {
  const output = JSON.stringify({ ...valid, impact: { password: "PRIVATE_VALUE" }, SECRET_TOKEN_NAME: "PRIVATE_VALUE", analysis: "PRIVATE_VALUE" });
  assert.throws(() => parseStructuredOutput(output, schema, true), error => {
    assert.ok(error instanceof ModelError);
    const root = error.diagnostic!.issues!.find(issue => issue.path === "")!;
    assert.deepEqual(root.unexpectedKeys, ["impact", "analysis"]); assert.equal(root.extraKeyCount, 3); assert.equal(root.withheldKeyCount, 1);
    assert.equal(error.diagnostic!.schemaFailure!.outputBytes, Buffer.byteLength(output));
    assert.equal(error.diagnostic!.schemaFailure!.outputSha256, createHash("sha256").update(output).digest("hex"));
    assert.ok(!JSON.stringify(error.diagnostic).includes("PRIVATE_VALUE")); assert.ok(!JSON.stringify(error.diagnostic).includes("SECRET_TOKEN_NAME"));
    return true;
  });
  assert.throws(() => parseStructuredOutput(JSON.stringify(invalid.at(-1)), schema, true), error => {
    assert.ok(error instanceof ModelError); assert.equal(error.diagnostic?.issues?.[0].path, "claims.[]"); return true;
  });
});
test("Blocked synthesis uses common schema-bearing dispatch; canonical provenance is attached only after validation", async t => {
  const previous = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "fixture";
  t.after(() => { if (previous === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = previous; });
  let returned: unknown = valid, calls = 0;
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    assert.equal(url, "https://inference.baseten.co/v1/chat/completions"); calls++;
    const body = JSON.parse(String(init?.body)); assert.equal(body.max_tokens, 8192); assert.equal(body.stream, false);
    assert.equal(body.response_format, undefined);
    assert.match(body.messages[0].content, /exactly these five keys: assessment, summary, claims, contradictions, uncertainties/);
    assert.match(body.messages[0].content, /Do not wrap/);
    const format = JSON.parse(body.messages[0].content.split("Return only JSON matching this schema: ")[1]);
    assert.equal(format.additionalProperties, false); assert.equal(format.properties.claims.items.additionalProperties, false);
    assert.equal(format.properties.provenance, undefined);
    const input = JSON.parse(body.messages[1].content);
    assert.equal(input.source.head, fixture.source.bundle.head); assert.equal(input.captures.length, 2);
    assert.ok(input.source.findings.some((f: {description:string}) => f.description.includes("Blocked")));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(returned) } }] });
  });
  const source = storedProductResult.parse(fixture.source);
  const runtime = runtimeVisualEvidenceList.parse(fixture.runtime);
  const runtimeInspection = runtimeInspectionContextSchema.parse(fixture.runtimeInspection);
  const result = await synthesizeProductImpact({ source, runtime, runtimeInspection });
  assert.equal(result.impact.provenance.source.head, source.bundle.head);
  assert.equal(result.impact.provenance.captures.length, 2);
  assert.ok(!("provenance" in valid));
  for (const output of invalid) {
    returned = output;
    await assert.rejects(synthesizeProductImpact({ source, runtime, runtimeInspection }), error => error instanceof ModelError && error.code === "schema-mismatch");
  }
  assert.equal(calls, invalid.length + 1);
  assert.ok(!result.impact.uncertainties.includes(RUNTIME_REVISION_WARNING)); // Source-only claims do not invent visual support.
});
