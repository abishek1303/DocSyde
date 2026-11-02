import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { visualSelectionOutputSchema, visualSelectionSchema, SELECTION_OUTPUT_TOKENS, type VisualSelectionOutput } from "./visual-selection";
import { selectVisualCheckpoints, validateVisualSelection, visualSelectionInstructions } from "./select-visual-checkpoints";
import { summarizeRuntimeStates, type RuntimeStateSummary } from "./runtime-state-summary";
import { rejectionDiagnostic } from "@/integrations/ai/invocation-debug";
import { visualSourceFixture, visualTraceFixture } from "../../../../infra/local/runner/visual-fixtures";
import fixtures from "../../../../infra/local/runner/visual-selection-inputs.json";

const item = () => ({ checkpointId: randomUUID(), sourceRefs: ["source-1"], question: "What guidance is visible?" });
test("wire is compact and strict, with dynamic 0/1/2/3 limits and no redundant fields", () => {
  for (const limit of [0, 1, 2, 3]) {
    const schema = visualSelectionOutputSchema(limit);
    assert.equal(schema.parse({ selected: [] }).selected.length, 0);
    assert.equal(schema.parse({ selected: Array.from({ length: limit }, item) }).selected.length, limit);
    assert.equal(schema.safeParse({ selected: Array.from({ length: limit + 1 }, item) }).success, false);
    const property = z.toJSONSchema(schema).properties!.selected;
    assert.ok(typeof property === "object"); assert.equal(property.maxItems, limit);
  }
  const schema = visualSelectionOutputSchema(3), output = { selected: [item()] };
  for (const key of ["decision", "reason", "uncertainties", "priority", "order", "result", "schema", "version"]) {
    assert.equal(schema.safeParse({ ...output, [key]: "extra" }).success, false);
    assert.equal(schema.safeParse({ selected: [{ ...item(), [key]: "extra" }] }).success, false);
  }
  assert.equal(schema.safeParse({ selected: [{ ...item(), sourceRefs: Array(5).fill("source-1") }] }).success, false);
  for (const question of ["", " ", "\n\t", "x".repeat(81)]) assert.equal(schema.safeParse({ selected: [{ ...item(), question }] }).success, false);
  for (const question of ["x".repeat(80), "é".repeat(80), "😀".repeat(40), 'Quote " and slash \\?']) {
    const output = { selected: [{ ...item(), question }] };
    assert.deepEqual(schema.parse(JSON.parse(JSON.stringify(output))), output);
  }
  assert.throws(() => visualSelectionOutputSchema(4));
  assert.throws(() => visualSelectionOutputSchema(1.5));
});

test("independent correspondence rejects identities/counts/references with fixed diagnostics, preserving order", () => {
  const f = visualTraceFixture(3), summary = summarizeRuntimeStates(visualSourceFixture(), f.trace, "Inspect").input;
  const output = { selected: summary.candidates.map(cp => ({ ...item(), checkpointId: cp.checkpointId })) };
  const cases: [string, string, VisualSelectionOutput, number][] = [
    ["unknown-checkpoint", "selected[0].checkpointId", { selected: [item()] }, 3],
    ["unknown-checkpoint", "selected[0].checkpointId", { selected: [{ ...item(), checkpointId: f.trace.states[0].stateId }] }, 3],
    ["duplicate-checkpoint", "selected[1].checkpointId", { selected: [output.selected[0], output.selected[0]] }, 3],
    ["excessive-selection-count", "selected", output, 1],
    ["unknown-source-reference", "selected[0].sourceRefs[0]", { selected: [{ ...output.selected[0], sourceRefs: ["source-4"] }] }, 3],
    ["duplicate-source-reference", "selected[0].sourceRefs[1]", { selected: [{ ...output.selected[0], sourceRefs: ["source-1", "source-1"] }] }, 3],
  ];
  for (const [code, path, value, limit] of cases) {
    assert.throws(() => validateVisualSelection(structuredClone(value), summary, limit), error => {
      assert.deepEqual(rejectionDiagnostic(error, "correspondence-rejection"), { kind: "correspondence-rejection", validator: "visual-selection", code, path }); return true;
    });
  }
  output.selected.reverse(); const before = structuredClone(output);
  validateVisualSelection(output, summary, 3); assert.deepEqual(output, before);
  validateVisualSelection({ selected: [] }, summary, 3);
});

test("maximum compact JSON has a small measured byte bound; bytes are not Muse tokens", () => {
  const largest = (question: string) => ({ selected: Array.from({ length: 3 }, () => ({ checkpointId: randomUUID(), sourceRefs: ["source-1", "source-2", "source-3", "source-4"], question })) });
  assert.equal(Buffer.byteLength(JSON.stringify({ selected: [] })), 15);
  const ordinary = visualSelectionOutputSchema(3).parse(largest("x".repeat(80)));
  assert.equal(Buffer.byteLength(JSON.stringify(ordinary)), 641);
  // JSON-escaped control codepoints exercise the conservative wire bound; this is not expected model prose.
  const escaped = visualSelectionOutputSchema(3).parse(largest("\u0001".repeat(80)));
  assert.equal(Buffer.byteLength(JSON.stringify(escaped)), 1841);
  assert.ok(Buffer.byteLength(JSON.stringify(visualSelectionOutputSchema(3).parse(largest("漢".repeat(80))))) < 1841);
  assert.equal(SELECTION_OUTPUT_TOKENS, 3072);
  // This is a serialization bound and reasoning headroom rationale, not a tokenizer measurement.
  assert.ok(Buffer.byteLength(JSON.stringify(escaped)) <= 1841);
});

test("frozen A/B/C inputs remain unchanged; B-like extras normalize before strict local validation", async t => {
  const old = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "offline-only";
  t.after(() => { if (old === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = old; });
  t.mock.method(console, "warn", () => {});
  let output: unknown, finish = "stop", calls = 0, expected: unknown;
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    calls++; assert.equal(String(url), "https://inference.baseten.co/v1/chat/completions");
    const body = JSON.parse(String(init?.body)); assert.equal(body.max_tokens, 3072); assert.equal(body.response_format, undefined);
    assert.deepEqual(JSON.parse(body.messages[1].content), expected);
    assert.ok(body.messages[0].content.startsWith(visualSelectionInstructions)); assert.match(body.messages[0].content, /"maxItems":1/);
    return Response.json({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(output) } }] });
  });
  for (const fixture of fixtures.scenarios) {
    // JSON import widens literal unions; validate the recorded enum fields rather than casting the fixture.
    const input = fixture.input;
    const { maxSelectedScreenshots: limit, ...data } = input;
    const schema = z.object({ kind: z.enum(["workflow-changed", "field-requirement-changed", "capability-added", "behavior-modified", "behavior-removed", "internal-change", "undetermined"]), support: z.enum(["directly-supported", "inferred"]) });
    const trigger = z.enum(["initial", "click", "fill", "select", "check", "waitFor", "checkpoint", "final"]);
    const summary: RuntimeStateSummary = { ...data, findings: data.findings.map(f => ({ ...f, ...schema.parse(f) })), states: data.states.map(state => ({ ...state, trigger: trigger.parse(state.trigger) })) };
    expected = fixture.input;
    const before = structuredClone(summary);
    output = { selected: [{ checkpointId: summary.candidates[0].checkpointId, sourceRefs: ["source-1"], question: "What relevant text is visible?" }] };
    // Mock choices exercise shape/correspondence only; they are not historical answers or relevance assertions.
    const result = await selectVisualCheckpoints(summary, limit);
    assert.deepEqual(result.selection, { version: 3, ...output as object }); assert.deepEqual(summary, before);
    if (fixture.scenario === "B") { output = { ...output as object, explanation: "extra root field" }; const normalized = await selectVisualCheckpoints(summary, limit); assert.deepEqual(normalized.selection, result.selection); }
    finish = "length"; const count = calls;
    await assert.rejects(selectVisualCheckpoints(summary, limit), /incomplete-output/); assert.equal(calls, count + 1); finish = "stop";
  }
});

test("historical retained selections remain strict and readable beside normalized v3", () => {
  const selected = item();
  const legacy = { decision: "analyze", reason: "Historical model reason", selected: [{ ...selected, reason: "Historical item reason" }], uncertainties: [] };
  assert.deepEqual(visualSelectionSchema.parse(legacy), legacy);
  assert.deepEqual(visualSelectionSchema.parse({ version: 3, selected: [selected] }), { version: 3, selected: [selected] });
  assert.equal(visualSelectionSchema.safeParse({ version: 3, selected: [selected], reason: "Invented rationale" }).success, false);
});
