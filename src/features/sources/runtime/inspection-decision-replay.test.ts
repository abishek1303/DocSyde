import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import saved from "./fixtures/c3ca9b6f-runtime-input.json";
import { inspectionSourceSchema, inspectionDecisionSchema } from "./inspection-decision";
import { inspectionDecisionIRSchema } from "./inspection-decision-ir";
import { inspectionSupportSchema } from "./inspection-capabilities";
import { decideRuntimeInspection } from "./decide-runtime-inspection";

// Replay the actual retained request, not a model response or a new inference.
const source = inspectionSourceSchema.parse({
  status: "insufficient-evidence", bytes: 0,
  bundle: { ...saved.input.bundle, evidence: saved.input.bundle.evidence
    .filter(e => !e.evidenceId.startsWith("inspection-"))
    .map(({ evidenceId, lines, ...entry }) => ({ ...entry, id: evidenceId, text: lines?.map(line => line[1]).join("\n") ?? null })) },
  analysis: { ...saved.input.analysis, findings: saved.input.analysis.findings.map(({ findingRef, ...finding }) => { assert.match(findingRef, /^finding-[1-4]$/); return finding; }) },
});
const supportingContext = inspectionSupportSchema.parse(saved.input.bundle.evidence.filter(e => e.evidenceId.startsWith("inspection-"))
  .map(e => ({ path: e.path, commitId: e.commitId, status: e.status, text: e.lines?.map(line => line[1]).join("\n") ?? null })));
const operatorCapabilities = { workflow: saved.workflow, capabilities: saved.input.targets.map(t => ({ id: t.capabilityId, pathname: t.pathname, description: t.description })) };
// Historical input stays byte-for-byte identical; only descriptive reason limits change.
const expectedSchema = structuredClone(saved.schema);
expectedSchema.properties.reason.maxLength = 180;
expectedSchema.properties.targets.items.properties.reason.maxLength = 180;
const expectedInstructions = saved.instructions.replace("all prose <=80 characters, targets <=3, uncertainties <=3.", "aim for prose <=80 characters (hard maximum 180), targets <=3, uncertainties <=3 and <=80 characters each.");
const inspect = { status: "inspect", reason: "Verify the conditional Blocked guidance", staticEvidence: "uncertain",
  targets: [{ findingRef: "finding-1", targetRef: "target-0", reason: "Observe guidance when the issue is Blocked" }], uncertainties: [] };

test("persisted c3ca9b6f input uses the compact prompt contract with unchanged grounding", async t => {
  const previous = { BASETEN_API_KEY: process.env.BASETEN_API_KEY, BASETEN_MODEL: process.env.BASETEN_MODEL, BASETEN_STRUCTURED_OUTPUT_MODE: process.env.BASETEN_STRUCTURED_OUTPUT_MODE };
  process.env.BASETEN_API_KEY = "offline-fixture";
  delete process.env.BASETEN_MODEL; delete process.env.BASETEN_STRUCTURED_OUTPUT_MODE;
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  let response: unknown = inspect;
  const fetch = t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    assert.equal(String(url), "https://inference.baseten.co/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.max_tokens, 4096);
    assert.equal(body.response_format, undefined);
    assert.equal(body.messages[0].content, `${expectedInstructions}\nReturn only JSON matching this schema: ${JSON.stringify(expectedSchema)}`);
    assert.deepEqual(JSON.parse(body.messages[1].content), saved.input);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(response) } }] });
  });
  for (const [name, output, rejection] of [
    ["inspect", inspect, null],
    ["not-needed", { ...inspect, status: "not-needed", targets: [] }, null],
    ["unresolved", { ...inspect, status: "unresolved", targets: [{ ...inspect.targets[0], targetRef: null }], uncertainties: ["No evidenced route for another desired observation"] }, null],
    ["unknown finding", { ...inspect, targets: [{ ...inspect.targets[0], findingRef: "finding-4" }] }, /unknown-source-reference/],
    ["unknown target", { ...inspect, targets: [{ ...inspect.targets[0], targetRef: "target-99" }] }, /unsupported-route/],
    ["excessive targets", { ...inspect, targets: Array(4).fill(inspect.targets[0]) }, /schema-mismatch/],
  ] as const) await t.test(name, async () => {
    response = output;
    const before = fetch.mock.callCount();
    const result = decideRuntimeInspection(source, { supportingContext, operatorCapabilities });
    if (rejection) await assert.rejects(result, rejection);
    else {
      const canonical = (await result).decision;
      assert.equal(inspectionDecisionSchema.safeParse(canonical).success, true);
      if (output.status === "inspect") {
        assert.equal(canonical.targets[0].pathname, "/");
        assert.equal(canonical.targets[0].capabilityId, "issue-status");
        assert.deepEqual(canonical.targets[0].citations, source.analysis!.findings[0].citations);
        assert.deepEqual(canonical.targets[0].visibleEvidence, [inspect.targets[0].reason]);
      }
    }
    assert.equal(fetch.mock.callCount(), before + 1);
  });
  assert.deepEqual(z.toJSONSchema(inspectionDecisionIRSchema), expectedSchema);
});
