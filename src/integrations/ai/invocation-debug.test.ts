import assert from "node:assert/strict";
import { test } from "node:test";
import { debugPolicy, debugRequest, debugOutput, debugSection, DEBUG_LIMITS, rejectionDiagnostic } from "./invocation-debug";
import { invocationDebugView } from "@/features/documentation/runs/invocation-debug-view";

test("operation policies default deny; transformation unknown entries and vision prose stay excluded", () => {
  for (const operation of ["unknown", "toString", "source-analysis"]) {
    assert.deepEqual(Object.values(debugPolicy(operation)), [false, false, false, false, false]);
    assert.equal(debugRequest(operation, "instructions", "input", "{}"), undefined);
    assert.equal(debugOutput(operation, { value: "private" }), undefined);
  }
  for (const operation of ["visual-selection", "runtime-decision", "documentation-planning", "product-impact"]) {
    assert.ok(debugRequest(operation, "instructions", "input", "{}"));
    assert.ok(debugOutput(operation, { value: "validated" }));
  }
  assert.ok(debugRequest("documentation-transformation", "instructions", "input", "{}"));
  assert.equal(debugOutput("documentation-transformation", { entries: ["UNVALIDATED"] }), undefined);
  assert.equal(debugOutput("runtime-vision", { visibleText: "UNAPPROVED" }), undefined);
});

test("snapshots enforce byte and serialized column bounds, original hash/length, explicit UTF-8 truncation", () => {
  const original = "😀".repeat(100000);
  const section = debugSection(original, 31);
  assert.equal(section.originalBytes, 400000); assert.ok(section.retainedBytes <= 31);
  assert.equal(section.retainedBytes, Buffer.byteLength(section.content));
  assert.ok(section.truncated); assert.ok(!section.content.includes("�"));
  assert.equal(section.sha256, debugSection(original, 400).sha256);
  const request = debugRequest("runtime-decision", "\u0001".repeat(100000), "\u0001".repeat(100000), "\u0001".repeat(100000))!;
  assert.ok(Buffer.byteLength(JSON.stringify(request)) <= DEBUG_LIMITS.column);
  const output = debugOutput("runtime-decision", { text: "\u0001".repeat(100000) })!;
  assert.ok(Buffer.byteLength(JSON.stringify(output)) <= DEBUG_LIMITS.column);
  assert.ok(output.output.truncated);
});

test("sanitization retains model-facing fields only and redacts credentials without process state", () => {
  const input = JSON.stringify({ safe: "source sent to model", credentials: "SECRET_ONE", nested: { api_key: "SECRET_TWO", Authorization: "SECRET_THREE" }, text: "Bearer SECRET_FOUR API_TOKEN=SECRET_FIVE" });
  const request = debugRequest("runtime-decision", "extract", input, "{}")!;
  const serialized = JSON.stringify(request);
  for (const secret of ["SECRET_ONE", "SECRET_TWO", "SECRET_THREE", "SECRET_FOUR", "SECRET_FIVE"]) assert.ok(!serialized.includes(secret));
  assert.ok(request.input.redacted); assert.ok(request.input.content.includes("source sent to model"));
  assert.deepEqual(Object.keys(request), ["version", "instructions", "input", "schema"]);
  const diagnostic = rejectionDiagnostic(new Error("UNSAFE_MESSAGE Bearer SECRET"), "correspondence-rejection");
  assert.equal(diagnostic.code, "validator-rejected"); assert.ok(!JSON.stringify(diagnostic).includes("UNSAFE"));
});

test("legacy and unsafe stored data render unavailable; schema and semantic failures are distinct", () => {
  const old = invocationDebugView({ operation: "runtime-decision", failureKind: "correspondence-rejection" });
  assert.equal(old.request, null); assert.equal(old.response, null); assert.equal(old.diagnostic, null);
  assert.match(old.validation, /Semantic.*schema-valid/);
  assert.match(invocationDebugView({ operation: "runtime-decision", failureKind: "schema-mismatch" }).validation, /Generation \/ schema-validation/);
  assert.equal(invocationDebugView({ operation: "unknown", failureKind: null, requestPayload: debugRequest("runtime-decision", "private", "private", "{}") }).request, null);
  assert.equal(invocationDebugView({ operation: "runtime-decision", failureKind: null, responsePayload: "RAW_UNSAFE", inferenceConfig: { headers: "SECRET" } }).config, null);
});


test("historical vision and selection display only strict approved projections", () => {
  const vision = invocationDebugView({ operation: "runtime-vision", failureKind: null, responsePayload: { elements: [], observationCount: 1, limitationCount: 0 } });
  assert.match(vision.responseAvailability, /projection/); assert.ok(vision.response);
  const hostile = invocationDebugView({ operation: "runtime-vision", failureKind: null, responsePayload: { elements: [], observationCount: 1, limitationCount: 0, visibleText: "UNSAFE" } });
  assert.equal(hostile.response, null);
  const selection = invocationDebugView({ operation: "visual-selection", failureKind: null, requestPayload: { input: '{"workflow":"safe"}' } });
  assert.ok(selection.input); assert.equal(selection.request, null);
});


test("selection debug uses existing byte/redaction bounds and legacy projections still decode", () => {
  const request = debugRequest("visual-selection", "x".repeat(10000), JSON.stringify({ text: "漢".repeat(20000), api_key: "UNSAFE_SECRET" }), "x".repeat(10000))!;
  assert.ok(request.instructions.retainedBytes <= DEBUG_LIMITS.instructions);
  assert.ok(request.input.retainedBytes <= DEBUG_LIMITS.input);
  assert.ok(request.schema.retainedBytes <= DEBUG_LIMITS.schema);
  assert.ok(Buffer.byteLength(JSON.stringify(request)) <= DEBUG_LIMITS.column);
  const legacy = { decision: "skip", selected: [] };
  const view = invocationDebugView({ operation: "visual-selection", failureKind: null, requestPayload: { input: '{"workflow":"safe"}' }, responsePayload: legacy });
  assert.deepEqual(JSON.parse(view.response!.output.content), legacy); assert.ok(view.input);
  assert.equal(invocationDebugView({ operation: "visual-selection", failureKind: null, responsePayload: { ...legacy, extra: "UNSAFE" } }).response, null);
});
