import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { decideRuntimeInspection } from "./decide-runtime-inspection";
import { type InspectionDecision } from "./inspection-decision";
import { inspectionRouteCandidates } from "./inspection-routes";
import opentodo from "./fixtures/opentodo-routes.json";
import type { ProductResult } from "../analysis/product-change-analysis";

const base = "a".repeat(40), head = "b".repeat(40);
const routeText = '<Link href="/requests/new">New request</Link>';
const routeCitation = { evidenceId: "head-route", startLine: 1, endLine: 1, excerpt: routeText };
const changeCitation = { evidenceId: "p1", startLine: 3, endLine: 3, excerpt: '+<button>Create request</button>' };
function source(): ProductResult {
  return { status: "analyzed", bytes: 0, bundle: {
    repository: "https://github.com/example/project", base, head, limited: false, notice: "Selected source only; runtime unverified.",
    inventory: [{ path: "form.tsx", previousPath: null, kind: "modified" }],
    evidence: [
      { id: "p1", path: "form.tsx", side: "patch", commitId: null, changed: true,
        status: "included", text: '@@ -1 +1 @@\n-<button>Submit</button>\n+<button>Create request</button>' },
      { id: "head-route", path: "navigation.tsx", side: "head", commitId: head, changed: false, status: "available", text: routeText },
    ],
  }, analysis: { assessment: "product-change", uncertainties: [], findings: [{ kind: "behavior-modified", description: "The visible button label changed",
    before: "Submit", after: "Create request", support: "directly-supported", confidence: "high", confidenceReason: "Literal patch",
    citations: [changeCitation], reachabilityEvidenceIds: [], assumptions: [], uncertainties: [],
  }] } };
}
const skip: InspectionDecision = { status: "not-needed", reason: "The supplied change is internal and inspection adds no visible evidence.", staticEvidence: "sufficient", targets: [], uncertainties: [] };
function provider(t: TestContext, output: unknown = skip) {
  const oldKey = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "fixture";
  t.after(() => { if (oldKey === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = oldKey; });
  let payload = "", instructions = "";
  const fetch = t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    assert.equal(url, "https://inference.baseten.co/v1/chat/completions");
    const body = JSON.parse(String(init.body)); payload = body.messages[1].content; instructions = body.messages[0].content;
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: typeof output === "string" ? output : JSON.stringify(output) } }] });
  });
  return { fetch, payload: () => payload, instructions: () => instructions };
}
function noChange(): ProductResult {
  const input = source(); input.status = "no-change"; input.analysis = null;
  input.bundle.inventory = []; input.bundle.evidence = []; return input;
}

test("consistent no-change returns a deterministic decision without provider access", async t => {
  const p = provider(t);
  const result = await decideRuntimeInspection(noChange());
  assert.equal(result.decision.status, "not-needed");
  assert.equal(result.decision.staticEvidence, "sufficient");
  assert.deepEqual(result.decision.targets, []);
  assert.equal(result.model, undefined); assert.equal(p.fetch.mock.callCount(), 0);
});

test("pre-cancellation wins before deterministic return or provider access", async t => {
  const p = provider(t); const controller = new AbortController(); const reason = new Error("cancelled"); controller.abort(reason);
  await assert.rejects(decideRuntimeInspection(noChange(), { signal: controller.signal }), error => error === reason);
  assert.equal(p.fetch.mock.callCount(), 0);
});

test("upstream errors and contradictory no-change inputs never invoke Baseten", async t => {
  const p = provider(t);
  const error = source(); error.status = "error"; error.analysis = null; error.error = "Upstream failed";
  await assert.rejects(decideRuntimeInspection(error), /upstream-analysis-error/);
  const variants = [source(), noChange(), noChange(), noChange(), noChange()];
  variants[0].status = "no-change";
  variants[1].bundle.inventory = source().bundle.inventory;
  variants[2].bundle.evidence = source().bundle.evidence;
  variants[3].bundle.limited = true;
  variants[4].error = "Prior failure";
  for (const input of variants) await assert.rejects(decideRuntimeInspection(input));
  assert.equal(p.fetch.mock.callCount(), 0);
});

test("runtime input validation rejects unknowns, unpinned/duplicate evidence and inconsistent statuses", async t => {
  const inputs: unknown[] = [
    { ...source(), extra: true }, { ...source(), bytes: -1 },
    { ...source(), analysis: null }, { ...source(), bundle: { ...source().bundle, base: "branch" } },
  ];
  const duplicate = source(); duplicate.bundle.evidence.push(duplicate.bundle.evidence[0]); inputs.push(duplicate);
  const unpinned = source(); unpinned.bundle.evidence[1].commitId = base; inputs.push(unpinned);
  const contradictory = source(); contradictory.bundle.evidence[0].changed = false; inputs.push(contradictory);
  const missingPatch = source(); missingPatch.bundle.evidence.shift(); inputs.push(missingPatch);
  const missingCoverage = source(); missingCoverage.bundle.evidence[0].text = null;
  missingCoverage.bundle.evidence[0].status = "unavailable"; inputs.push(missingCoverage);
  const p = provider(t);
  for (const input of inputs) await assert.rejects(decideRuntimeInspection(input as ProductResult));
  assert.equal(p.fetch.mock.callCount(), 0);
});

test("route extraction recognizes conservative literals and retains exact source coordinates", () => {
  const input = source();
  input.bundle.evidence[1].text = [routeText, 'router.get("/settings", handler);', 'path: "/account",'].join("\n");
  assert.deepEqual(inspectionRouteCandidates(input.bundle).map(candidate => [candidate.pathname, candidate.citation.startLine]), [["/requests/new", 1], ["/settings", 2], ["/account", 3]]);
  input.bundle.inventory[0].kind = "added";
  input.bundle.evidence = [{ ...input.bundle.evidence[0], text: `@@ -0,0 +1,1 @@\n+${routeText}` }];
  assert.deepEqual(inspectionRouteCandidates(input.bundle), [{ pathname: "/requests/new", citation: { ...routeCitation, evidenceId: "p1", startLine: 2, endLine: 2, excerpt: `+${routeText}` } }]);
});

test("comments, templates, removed/base evidence, filenames and composed paths are not route evidence", () => {
  for (const text of [
    `// ${routeText}`, `/*\n${routeText}\n*/`, `const html = \`\n${routeText}\n\`;`,
    `const example = '${routeText}';`, '<Link href={"/requests/" + id}>Request</Link>',
    'router.get("/requests/" + id, handler);', 'path: "/requests/" + id,',
    '<Link href="/requests/[id]">Request</Link>', '<Link href="/requests/:id">Request</Link>',
  ]) {
    const input = source(); input.bundle.evidence[1].text = text;
    assert.deepEqual(inspectionRouteCandidates(input.bundle), [], text);
  }
  const input = source(); input.bundle.evidence[1].side = "base"; input.bundle.evidence[1].commitId = base;
  assert.deepEqual(inspectionRouteCandidates(input.bundle), []);
  input.bundle.evidence[1].side = "head"; input.bundle.evidence[1].path = "navigation.md";
  assert.deepEqual(inspectionRouteCandidates(input.bundle), []);
});

function openTodoSource(): ProductResult {
  const input = source();
  input.bundle = { ...input.bundle, mode: "current-state", base: head, limited: true,
    inventory: Object.keys(opentodo).map(path => ({ path, previousPath: null, kind: "current-file" })),
    evidence: Object.entries(opentodo).map(([path, text], index) => ({ id: `snapshot-${index + 1}`, path, side: "head", commitId: head, text, changed: false, status: "available" })),
  };
  const route = inspectionRouteCandidates(input.bundle)[0];
  input.analysis!.findings[0] = { ...input.analysis!.findings[0], kind: "product-behavior", before: null, after: null, citations: [route.citation] };
  return input;
}
test("OpenTodo verified SPA root is selectable without invented operator capabilities", async t => {
  const input = openTodoSource();
  assert.deepEqual(inspectionRouteCandidates(input.bundle).map(route => route.pathname), ["/"]);
  const p = provider(t, { status: "inspect", reason: "Check the source-backed screen", staticEvidence: "uncertain",
    targets: [{ findingRef: "finding-1", targetRef: "target-0", reason: "Observe the application" }], uncertainties: [] });
  const result = await decideRuntimeInspection(input, { operatorCapabilities: { workflow: { id: "approved-root", version: "1", sha256: "a".repeat(64) }, capabilities: [] } });
  assert.equal(result.decision.status, "inspect");
  assert.equal(result.decision.targets[0].pathname, "/");
  assert.equal(result.decision.targets[0].capabilityId, undefined, "source discovery does not manufacture approved capabilities");
  assert.deepEqual(result.decision.targets[0].citations, input.analysis!.findings[0].citations);
  assert.equal(JSON.parse(p.payload()).targets[0].pathname, "/");
  assert.equal(p.fetch.mock.callCount(), 1, "reuse the existing decision call");
});
test("SPA discovery requires pinned entry evidence and cannot authorize arbitrary paths", () => {
  const input = openTodoSource();
  input.bundle.evidence = input.bundle.evidence.filter(file => file.path !== "src/client/main.tsx");
  assert.deepEqual(inspectionRouteCandidates(input.bundle), []);
  const mismatched = openTodoSource(); mismatched.bundle.base = base;
  assert.deepEqual(inspectionRouteCandidates(mismatched.bundle), []);
});
