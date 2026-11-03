import { z } from "zod";
import assert from "node:assert/strict";
import { test } from "node:test";
import { productChangeGenerationOutput, productChangeOutput, sourceGenerationLimits } from "./product-change-analysis";
import { productChangeInstructions } from "./product-change-prompt";
import { storedProductResult } from "./stored-product-result";
import { visualSourceFixture } from "../../../../infra/local/runner/visual-fixtures";

test("generation limits align with prose, accept maxima and reject overflow without tightening historical analysis", () => {
  const source=visualSourceFixture(); assert.ok(source.analysis);
  const base=source.analysis.findings[0];
  const { reachabilityEvidenceIds: _legacyReachability, ...generatedBase } = base;
  assert.ok(Array.isArray(_legacyReachability));
  const finding={...generatedBase,kind:"product-behavior",description:"x".repeat(500),before:"x".repeat(400),after:"x".repeat(400),
    confidenceReason:"x".repeat(sourceGenerationLimits.confidenceReason),
    citations:Array.from({length:2},()=>({evidenceId:base.citations[0].evidenceId,startLine:1,endLine:1}))};
  const output={uncertainties:source.analysis.uncertainties,findings:Array.from({length:4},()=>finding)};
  assert.ok(productChangeGenerationOutput.safeParse(output).success);
  for(const change of [{confidenceReason:"x".repeat(201)},{citations:[...finding.citations,base.citations[0]]},{citations:[{...base.citations[0],excerpt:"x".repeat(501)}]}]) {
    assert.equal(productChangeGenerationOutput.safeParse({...output,findings:[{...finding,...change}]}).success,false);
  }
  assert.equal(productChangeGenerationOutput.safeParse({...output,findings:[...output.findings,finding]}).success,false);
  for(const limit of [sourceGenerationLimits.confidenceReason]) assert.ok(productChangeInstructions.includes(`at most ${limit}`));
  const historical={...source.analysis,findings:[{...base,confidenceReason:"x".repeat(300),citations:Array.from({length:4},()=>base.citations[0])}]};
  assert.ok(productChangeOutput.safeParse(historical).success);
  assert.ok(storedProductResult.safeParse({...source,analysis:historical}).success);
  assert.equal(productChangeGenerationOutput.safeParse(historical).success,false);
});


test("native source schema preserves every generation bound and closed object", () => {
  const schema = z.toJSONSchema(productChangeGenerationOutput);
  const node = (value: z.core.JSONSchema.BaseSchema | boolean | undefined) => {
    assert.ok(value && typeof value === "object");
    return value;
  };
  const findings = node(schema.properties!.findings);
  assert.equal(findings.maxItems, 4);
  const item = findings.items as z.core.JSONSchema.BaseSchema;
  const fields = Object.fromEntries(Object.entries(item.properties!).map(([key, value]) => [key, node(value)]));
  for (const [field, maximum] of Object.entries({ description: 500, confidenceReason: 200, audience: 200, surface: 200 })) {
    assert.equal(fields[field].maxLength, maximum);
  }
  for (const field of ["before", "after"]) assert.equal(node(fields[field].anyOf![0]).maxLength, 400);
  assert.equal(fields.citations.maxItems, 2);
  assert.equal("reachabilityEvidenceIds" in fields, false);
  assert.deepEqual(fields.kind.enum, ["product-behavior", "internal-change", "undetermined"]);
  for (const array of [fields.assumptions, fields.uncertainties, node(schema.properties!.uncertainties)]) {
    assert.equal(array.maxItems, 4);
    assert.equal((array.items as z.core.JSONSchema.BaseSchema).maxLength, 300);
  }
  const citation = fields.citations.items as z.core.JSONSchema.BaseSchema;
  assert.equal(node(citation.properties!.evidenceId).maxLength, 30);
  for (const line of ["startLine", "endLine"]) {
    assert.equal(node(citation.properties![line]).minimum, 1);
    assert.equal(node(citation.properties![line]).maximum, Number.MAX_SAFE_INTEGER);
  }
  for (const object of [schema, item, citation]) assert.equal(object.additionalProperties, false);
  assert.equal("excerpt" in citation.properties!, false);
  assert.equal("assessment" in schema.properties!, false);
});
