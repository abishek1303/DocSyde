import assert from "node:assert/strict";
import { test } from "node:test";
import { productChangeGenerationOutput, productChangeOutput, sourceGenerationLimits } from "./product-change-analysis";
import { productChangeInstructions } from "./product-change-prompt";
import { storedProductResult } from "./stored-product-result";
import { visualSourceFixture } from "../../../../infra/local/runner/visual-fixtures";

test("generation limits align with prose, accept maxima and reject overflow without tightening historical analysis", () => {
  const source=visualSourceFixture(); assert.ok(source.analysis);
  const base=source.analysis.findings[0];
  const finding={...base,description:"x".repeat(500),before:"x".repeat(400),after:"x".repeat(400),
    confidenceReason:"x".repeat(sourceGenerationLimits.confidenceReason),
    citations:Array.from({length:2},()=>({evidenceId:base.citations[0].evidenceId,startLine:1,endLine:1}))};
  const output={...source.analysis,findings:Array.from({length:4},()=>finding)};
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
