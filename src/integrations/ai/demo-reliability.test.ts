import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { demoReliabilityMode, maxModelAttempts } from "./demo-reliability";
import { resolveInference, effectiveRunInferencePolicy, runInferencePolicy } from "./operation-policy";
import { productEvidenceBudgetBytes } from "@/features/sources/analysis/product-change-limits";
import { selectionRequestBytes } from "@/features/sources/runtime/visual-selection";
import { boundInspectionContext } from "@/features/sources/runtime/read-inspection-context";
import { serializeProductEvidence } from "@/features/sources/analysis/product-change-evidence";
import fixture from "@/features/sources/analysis/fixtures/blocked-status.json";
import type { ProductBundle } from "@/features/sources/analysis/product-change-analysis";
import { redactRuntimeText } from "@/integrations/browser/runtime-redaction";
import { withRunInferenceBudget, admitInference, inferenceBudgetUsage } from "./inference-budget";
function mode(t:TestContext,value:string|undefined){const prior=process.env.DEMO_RELIABILITY_MODE;if(value===undefined)delete process.env.DEMO_RELIABILITY_MODE;else process.env.DEMO_RELIABILITY_MODE=value;t.after(()=>{if(prior===undefined)delete process.env.DEMO_RELIABILITY_MODE;else process.env.DEMO_RELIABILITY_MODE=prior;});}

test("demo is opt-in and defaults retain exact attempts, token and evidence limits",async t=>{
 for(const value of [undefined,"false","TRUE","1"])await t.test(String(value),t=>{
  mode(t,value);assert.equal(demoReliabilityMode(),false);assert.equal(maxModelAttempts(),3);
  assert.equal(resolveInference("baseten","source-analysis").maxOutputTokens,8192);
  assert.equal(productEvidenceBudgetBytes(),102400);assert.equal(selectionRequestBytes(),32768);
  assert.deepEqual(effectiveRunInferencePolicy(),runInferencePolicy);
 });
});
test("demo known model allowances are generous but bounded, unknown models retain their initial budget",t=>{
 mode(t,"true");assert.equal(maxModelAttempts(),5);
 assert.equal(resolveInference("baseten","runtime-decision",4096).maxOutputTokens,16384);
 assert.equal(resolveInference("meta","documentation-composition").maxOutputTokens,8192);
 const previous=process.env.BASETEN_MODEL;process.env.BASETEN_MODEL="unknown-model";
 t.after(()=>{if(previous===undefined)delete process.env.BASETEN_MODEL;else process.env.BASETEN_MODEL=previous;});
 assert.equal(resolveInference("baseten","source-analysis").maxOutputTokens,8192);
 assert.equal(effectiveRunInferencePolicy().maxElapsedMs,40*60_000);
 assert.equal(effectiveRunInferencePolicy().maxCalls,96);assert.equal(effectiveRunInferencePolicy().maxTokens,8*1024*1024);
});
test("demo preserves larger source/inspection context without changing IDs, lines, selection or redaction",t=>{
 mode(t,"true");assert.equal(productEvidenceBudgetBytes(),256*1024);assert.equal(selectionRequestBytes(),96*1024);
 const source=structuredClone(fixture.bundle) as ProductBundle;
 source.evidence[0].text="+ supported source line\n"+"x".repeat(110*1024);
 const input=JSON.parse(serializeProductEvidence(source));
 assert.equal(input.evidence[0].evidenceId,source.evidence[0].id);
 assert.deepEqual(input.evidence[0].lines[0],[1,"+ supported source line"]);
 assert.equal(input.evidence[0].lines[1][1].length,110*1024);
 const text="x".repeat(32*1024);
 const context=boundInspectionContext([{path:"selected.ts",text,status:"available",contentId:"pinned",size:text.length,url:"https://example.com/source"}],"a".repeat(40));
 assert.equal(context[0].text,text);assert.equal(context[0].path,"selected.ts");assert.equal(context[0].commitId,"a".repeat(40));
 assert.ok(!redactRuntimeText("password=PRIVATE_VALUE visible label",[],4000).includes("PRIVATE_VALUE"));
});
test("demo evidence enlargement still rejects over-budget input instead of silently dropping it",t=>{
 mode(t,"true");const source=structuredClone(fixture.bundle) as ProductBundle;
 source.evidence[0].text="x".repeat(257*1024);assert.throws(()=>serializeProductEvidence(source),/byte budget/);
});
test("demo call reservations still honor a caller's smaller token/time limits",async t=>{
 mode(t,"true");const settings=resolveInference("baseten","source-analysis");
 await withRunInferenceBudget("demo-budget",async()=>{
  await admitInference("baseten","source-analysis",settings,"demo-budget",100);
  assert.equal(inferenceBudgetUsage()?.calls,1);
  await assert.rejects(admitInference("baseten","source-analysis",settings,"demo-budget",100),/inference-budget-exceeded/);
 },{maxTokens:17000});
});

test("demo never normalizes invalid token settings or bypasses model context ceilings",async t=>{
 mode(t,"true");for(const max of [0,-1,1.5,NaN])assert.throws(()=>resolveInference("baseten","source-analysis",max),/invalid-input/);
 const settings=resolveInference("baseten","source-analysis");
 await assert.rejects(admitInference("baseten","source-analysis",{...settings,maxOutputTokens:32769},undefined,0),/inference-budget-exceeded/);
 await assert.rejects(admitInference("baseten","source-analysis",settings,undefined,1048576),/inference-budget-exceeded/);
});
