import { test } from "node:test";
import assert from "node:assert/strict";
import blockedDecision from "./fixtures/blocked-decision.json";
import fixture from "../impact/fixtures/blocked-impact.json";
import { storedProductResult } from "../analysis/stored-product-result";
import { inspectionDecisionIRSchema, type InspectionDecisionIR } from "./inspection-decision-ir";
import { decideRuntimeInspection, resolveRuntimeDecision, runtimeDecisionTargets, validateRuntimeDecision } from "./decide-runtime-inspection";
import { inspectionRouteCandidates } from "./inspection-routes";
import { inspectionDecisionSchema } from "./inspection-decision";
import { rejectionDiagnostic } from "@/integrations/ai/invocation-debug";
const source = storedProductResult.parse(fixture.source);
const authority = { workflow: { id: "blocked", version: "1", sha256: "a".repeat(64) }, capabilities: [{ id: "issue-status", pathname: "/", description: "Observe issue status and grouped list." }] };
const targets = runtimeDecisionTargets([], authority);
const inspect: InspectionDecisionIR = inspectionDecisionIRSchema.parse(blockedDecision);

test("compact inspect resolves exact canonical capability/path/citations without model echoes", () => {
  const canonical = resolveRuntimeDecision(inspect, source, targets);
  validateRuntimeDecision(canonical, source.bundle, [], authority);
  assert.equal(canonical.targets[0].pathname, "/"); assert.equal(canonical.targets[0].capabilityId, "issue-status");
  assert.deepEqual(canonical.targets[0].citations, source.analysis!.findings[2].citations);
  assert.deepEqual(canonical.targets[0].visibleEvidence, [inspect.targets[0].reason]);
  assert.ok(inspectionDecisionSchema.safeParse(canonical).success);
});
test("not-needed/unresolved meanings and bounded uncertainty are preserved", () => {
  const skip = { ...inspect, status: "not-needed" as const, targets: [] };
  assert.equal(resolveRuntimeDecision(skip, source, targets).status, "not-needed");
  const unresolved = { ...inspect, status: "unresolved" as const, targets: [{ ...inspect.targets[0], targetRef: null }], uncertainties: ["No justified route for the desired inspection"] };
  assert.equal(resolveRuntimeDecision(unresolved, source, targets).targets[0].pathname, null);
  const noFindings = storedProductResult.parse({ ...source, status: "insufficient-evidence", analysis: null });
  assert.equal(resolveRuntimeDecision({ ...unresolved, targets: [] }, noFindings, targets).status, "unresolved");
  assert.ok(!inspectionDecisionIRSchema.safeParse({ ...unresolved, uncertainties: [] }).success);
  assert.ok(!inspectionDecisionIRSchema.safeParse({ ...inspect, targets: unresolved.targets }).success);
  assert.ok(!inspectionDecisionIRSchema.safeParse({ ...unresolved, targets: inspect.targets }).success);
});
test("three targets and 180-character prose accept equality, reject overflow/control characters/echoes", () => {
  const max = { ...inspect, reason: "x".repeat(180), targets: [1, 2, 3].map(i => ({ findingRef: `finding-${i}`, targetRef: "target-0", reason: "x".repeat(180) })), uncertainties: Array(3).fill("x".repeat(80)) };
  assert.ok(inspectionDecisionIRSchema.safeParse(max).success);
  const three = resolveRuntimeDecision(max, source, targets);
  assert.equal(three.targets.length, 3);
  validateRuntimeDecision(three, source.bundle, [], authority);
  for (const output of [{ ...max, reason: "x".repeat(181) }, { ...max, targets: [...max.targets, max.targets[0]] }, { ...max, uncertainties: Array(4).fill("unknown") }, { ...max, uncertainties: ["x".repeat(181)] }, { ...max, targets: [{ ...max.targets[0], reason: "x".repeat(181) }] }, { ...inspect, reason: "x\ny" }, { ...inspect, reason: "x\u2028y" }, { ...inspect, reason: " " }, { ...inspect, targets: [{ ...inspect.targets[0], pathname: "/invented" }] }, { ...inspect, impact: {} }]) assert.ok(!inspectionDecisionIRSchema.safeParse(output).success);
});
test("invented finding/target IDs and duplicate selections reject with safe correspondence diagnostics", () => {
  const withoutFourth = { ...source, analysis: { ...source.analysis!, findings: source.analysis!.findings.slice(0, 3) } };
  for (const [output, code, input] of [
    [{ ...inspect, targets: [{ ...inspect.targets[0], findingRef: "finding-4" }] }, "unknown-source-reference", withoutFourth],
    [{ ...inspect, targets: [{ ...inspect.targets[0], targetRef: "target-9" }] }, "unsupported-route", source],
    [{ ...inspect, targets: [inspect.targets[0], inspect.targets[0]] }, "duplicate-reference", source],
  ] as const) assert.throws(() => resolveRuntimeDecision(output, input, targets), error => {
    assert.equal(rejectionDiagnostic(error, "correspondence-rejection").code, code); return true;
  });
  assert.ok(!inspectionDecisionIRSchema.safeParse({ ...inspect, targets: [{ ...inspect.targets[0], findingRef: "invented" }] }).success);
});
test("source-route authority reconstructs the exact supporting citation and preserves legacy validators", () => {
  const evidence = { id: "head-route", path: "route.ts", side: "head" as const, commitId: source.bundle.head, text: 'path: "/issues",', status: "available", changed: false };
  const bundle = { ...source.bundle, evidence: [...source.bundle.evidence, evidence] };
  const routes = inspectionRouteCandidates(bundle);
  const canonical = resolveRuntimeDecision(inspect, source, runtimeDecisionTargets(routes));
  assert.equal(canonical.targets[0].pathname, "/issues");
  assert.deepEqual(canonical.targets[0].citations[0], routes[0].citation);
  validateRuntimeDecision(canonical, bundle, routes);
  assert.throws(() => validateRuntimeDecision({ ...canonical, targets: [{ ...canonical.targets[0], pathname: "/invented" }] }, bundle, routes), /unsupported-route/);
  assert.throws(() => validateRuntimeDecision({ ...canonical, targets: [{ ...canonical.targets[0], citations: [{ ...routes[0].citation, excerpt: "fabricated" }] }] }, bundle, routes), /citation-range-mismatch/);
});
test("mocked Meta dispatch and canonical return preserve runtime inspection compatibility and limits", async t => {
  const old = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "fixture";
  t.after(() => { if(old === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = old; });
  let output: unknown = inspect;
  const mock = t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    assert.equal(url, "https://inference.baseten.co/v1/chat/completions");
    const body = JSON.parse(String(init?.body)); assert.equal(body.model, "meta-models/muse-spark-open-1026"); assert.equal(body.max_tokens, 4096);
    assert.equal(body.reasoning_effort, "low"); assert.equal(body.response_format, undefined);
    assert.ok(body.messages[0].content.includes("Return only JSON matching this schema:"));
    assert.match(body.messages[0].content, /No wrapper/); assert.match(body.messages[0].content, /chain-of-thought/);
    const input = JSON.parse(body.messages[1].content); assert.equal(input.targets[0].targetRef, "target-0"); assert.equal(input.analysis.findings[2].findingRef, "finding-3");
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] });
  });
  const result = await decideRuntimeInspection(source, { operatorCapabilities: authority });
  assert.equal(result.decision.status, "inspect"); assert.equal(result.decision.targets[0].pathname, "/");
  output = { ...inspect, status: "not-needed", targets: [] };
  await assert.rejects(decideRuntimeInspection({ ...source, bundle: { ...source.bundle, limited: true } }, { operatorCapabilities: authority }), /limited-evidence-not-needed/);
  assert.equal(mock.mock.callCount(), 2);
});

test("reconstructed evidence still rejects unavailable/invalid citations and expanded operator scope", () => {
  const canonical = resolveRuntimeDecision(inspect, source, targets);
  const citation = canonical.targets[0].citations[0];
  for (const bad of [{ ...citation, evidenceId: "invented" }, { ...citation, endLine: 99999 }]) {
    assert.throws(() => validateRuntimeDecision({ ...canonical, targets: [{ ...canonical.targets[0], citations: [bad] }] }, source.bundle, [], authority));
  }
  const unavailable = { ...source.bundle, evidence: source.bundle.evidence.map(e => e.id === citation.evidenceId ? { ...e, text: null } : e) };
  assert.throws(() => validateRuntimeDecision(canonical, unavailable, [], authority), /unavailable-evidence/);
  assert.throws(() => validateRuntimeDecision({ ...canonical, targets: [{ ...canonical.targets[0], pathname: "/expanded" }] }, source.bundle, [], authority), /unsupported-capability/);
});

test("request budgets and pre-cancellation fail before dispatch; malformed model output is not repaired", async t => {
  const old = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "fixture";
  t.after(() => { if(old === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = old; });
  const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "malformed" } }] }));
  const tooLarge = structuredClone(source); tooLarge.bundle.evidence[0].text += "x".repeat(110000);
  await assert.rejects(decideRuntimeInspection(tooLarge), /request-over-budget/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(decideRuntimeInspection(source, { signal: controller.signal })); assert.equal(mock.mock.callCount(), 0);
  await assert.rejects(decideRuntimeInspection(source), { code: "invalid-json" }); assert.equal(mock.mock.callCount(), 1);
});
