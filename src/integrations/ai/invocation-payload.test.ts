import assert from "node:assert/strict";
import { test } from "node:test";
import { requestPayload, responsePayload, INVOCATION_PAYLOAD_MAX_BYTES } from "./invocation-payload";

test("default deny omits source-bearing requests and responses without serialization", () => {
  for (const operation of ["source-analysis","source-summary","runtime-decision","product-impact","documentation-planning","documentation-draft","documentation-transformation","unknown"]) {
    assert.equal(requestPayload(operation,"PRIVATE_SOURCE_PATCH Bearer PRIVATE_KEY data:image/png;base64,PRIVATE_IMAGE").payload,null);
    assert.equal(responsePayload(operation).reason,"not-allowlisted");
  }
});
test("approved requests preserve the exact final input string, never truncate oversized JSON", () => {
  const input=' {"workflow":"visible", "text":"escaped\\nvalue"} \n';
  assert.deepEqual(requestPayload("visual-selection",input),{payload:{input},reason:null});
  assert.equal(requestPayload("visual-selection","x".repeat(INVOCATION_PAYLOAD_MAX_BYTES)).reason,"oversized");
  assert.equal(requestPayload("receipt-verification","PRIVATE_SOURCE").payload,null);
});
test("strict accepted response projections reject prose and unknown fields", () => {
  const payload={decision:"skip" as const,selected:[]};
  assert.deepEqual(responsePayload("visual-selection",{operation:"visual-selection",payload}),{payload,reason:null});
  const hostile={operation:"visual-selection",payload:{...payload,reason:"PRIVATE_CREDENTIAL"}};
  assert.equal(responsePayload("visual-selection",hostile as Parameters<typeof responsePayload>[1]).payload,null);
  assert.equal(responsePayload("runtime-vision",{operation:"visual-selection",payload}).payload,null);
  assert.equal(responsePayload("transformation-support",{operation:"transformation-support",payload:{verdicts:[{unitId:"decision-1-unit-1",verdict:"unsupported"}]}}).reason,null);
});
test("oversized, circular and invalid projection data is omitted safely", () => {
  const huge={operation:"visual-selection",payload:{decision:"skip",selected:[],unexpected:"x".repeat(INVOCATION_PAYLOAD_MAX_BYTES)}};
  assert.equal(responsePayload("visual-selection",huge as Parameters<typeof responsePayload>[1]).reason,"oversized");
  const circular: {self?:unknown}={}; circular.self=circular;
  assert.equal(responsePayload("runtime-vision",{operation:"runtime-vision",payload:circular} as Parameters<typeof responsePayload>[1]).reason,"logging-data-invalid");
});
