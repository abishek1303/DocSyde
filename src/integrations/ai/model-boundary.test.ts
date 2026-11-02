import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { parseOrExtractSingleJson, newBoundaryTrace, normalizeModelBoundary, modelFacingSchema } from "./model-boundary";
import { parseStructuredOutput } from "./structured-output";
import blockedDecision from "@/features/sources/runtime/fixtures/blocked-decision.json";
import blocked from "@/features/sources/impact/fixtures/blocked-impact.json";
import { inspectionDecisionIRSchema } from "@/features/sources/runtime/inspection-decision-ir";
import { resolveRuntimeDecision, runtimeDecisionTargets, validateRuntimeDecision } from "@/features/sources/runtime/decide-runtime-inspection";
import { storedProductResult } from "@/features/sources/analysis/stored-product-result";

for (const [text, extraction] of [
  ['{"value":"yes"}', "none"], ['```json\n{"value":"yes"}\n```', "fence"],
  ['Here is the result: {"value":"yes"}', "surrounded"], ['{"value":"yes"} Done.', "surrounded"],
  ['\uFEFF \n{"value":"yes"}\t', "bom"], [' \n{"value":"yes"}\t', "none"],
  ['Result: [1,2] Done.', "surrounded"], ['{"value":"a } [ \\\" b"}', "none"],
] as const) test(`conservative JSON ${extraction}: ${text}`, () => {
  const trace = newBoundaryTrace(text, 1); const value = parseOrExtractSingleJson(text, trace);
  assert.ok(value); assert.equal(trace.extraction, extraction); assert.equal(trace.strictParse, extraction === "none");
});
for (const text of ['{} {}', '{} }', '{"value":1},', '"{"value":1}"', 'Result: {} and []', '{"a":1', '{"a":1 "b":2}', 'broken', '```json\n{broken}\n```', '{ broken {"value":"yes"}', 'x'.repeat(1025)+'{}', '{} trailing {broken']) {
  test(`unrecoverable JSON: ${text.slice(0,60)}`, () => {
    const trace = newBoundaryTrace(text, 1); assert.throws(() => parseOrExtractSingleJson(text, trace));
    assert.ok(["failed", "ambiguous"].includes(trace.extraction)); assert.equal(trace.outputSha256.length, 64);
  });
}
const schema = z.object({ value: z.string(), targets: z.array(z.object({ id: z.string() }).strict()), notes: z.array(z.string()).default([]) }).strict();
function normalize(value: unknown) {
  const trace = newBoundaryTrace(JSON.stringify(value), 1);
  const normalized = normalizeModelBoundary(value, schema, trace);
  return { data: parseStructuredOutput(JSON.stringify(normalized), schema), trace };
}
test("separate model schema accepts extras, canonical schema remains strict; defaults are declared only", () => {
  const input = { value: "yes", targets: [{id:"claim-1", metadata:{secret:"never retained"}}], confidence:0.9 };
  assert.ok(modelFacingSchema(schema).safeParse(input).success);
  assert.ok(!schema.safeParse(input).success);
  const {data,trace}=normalize(input);
  assert.deepEqual(data,{value:"yes",targets:[{id:"claim-1"}],notes:[]});
  assert.equal(trace.ignoredCount,2);assert.ok(!JSON.stringify(trace).includes("secret"));
});
test("explicit single wrapper unwraps; mixed and competing wrappers reject", () => {
  assert.equal(normalize({result:{value:"yes",targets:[]},metadata:{}}).trace.wrapper,"result");
  const competing = {result:{value:"yes",targets:[]},impact:{value:"yes",targets:[]}};
  assert.throws(()=>normalizeModelBoundary(competing,schema,newBoundaryTrace(JSON.stringify(competing),1),["result"]));
  for(const value of [{value:"yes",result:{value:"yes",targets:[]}}, {result:{value:"yes",targets:[]},analysis:{value:"no",targets:[]}}, {result:{garbage:true}}]) assert.throws(()=>normalize(value));
});
test("missing semantics, wrong types and enum/state values are never repaired", () => {
  assert.throws(()=>normalize({targets:[]})); assert.throws(()=>normalize({value:3,targets:[]}));
  const trace=newBoundaryTrace("{}",1);
  assert.ok(!inspectionDecisionIRSchema.safeParse(normalizeModelBoundary({...blockedDecision,status:"maybe"},inspectionDecisionIRSchema,trace)).success);
});
test("Blocked routing extras normalize but invented references, expanded routes and citation mismatch still reject", () => {
  const source=storedProductResult.parse(blocked.source);
  const authority={workflow:{id:"blocked",version:"1",sha256:"a".repeat(64)},capabilities:[{id:"issue-status",pathname:"/",description:"Issue status"}]};
  const targets=runtimeDecisionTargets([],authority);
  const canonical=(raw:unknown)=>inspectionDecisionIRSchema.parse(normalizeModelBoundary(raw,inspectionDecisionIRSchema,newBoundaryTrace(JSON.stringify(raw),1)));
  const valid=canonical({...blockedDecision,summary:"inspect",targets:blockedDecision.targets.map(t=>({...t,metadata:{confidence:1}}))});
  const decision=resolveRuntimeDecision(valid,source,targets);validateRuntimeDecision(decision,source.bundle,[],authority);
  for(const target of [{...blockedDecision.targets[0],targetRef:"target-999"},{...blockedDecision.targets[0],findingRef:"invented-finding"}]) assert.throws(()=>resolveRuntimeDecision(canonical({...blockedDecision,targets:[target]}),source,targets));
  assert.throws(()=>validateRuntimeDecision({...decision,targets:[{...decision.targets[0],pathname:"/invented"}]},source.bundle,[],authority));
  const citations=decision.targets[0].citations.map(c=>({...c,excerpt:"fabricated"}));
  assert.throws(()=>validateRuntimeDecision({...decision,targets:[{...decision.targets[0],citations}]},source.bundle,[],authority));
});
