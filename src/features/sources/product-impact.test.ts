import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { synthesizeProductImpact } from "./synthesize-product-impact";
import type { ProductResult } from "./product-change-analysis";
import { productImpactOutputSchema } from "./product-impact";
import { RUNTIME_REVISION_WARNING, type RuntimeVisualEvidence } from "./runtime-visual-evidence";
import { validateProductImpact } from "./validate-product-impact";
import type { ProductImpact } from "./product-impact";
import type { z } from "zod";

type Output = z.infer<typeof productImpactOutputSchema>;
const captureId = "11111111-1111-4111-8111-111111111111";
const artifactKey = "22222222-2222-4222-8222-222222222222";
const visualId = `visual:${captureId}:elements:0`;
function source(internal = false): ProductResult {
  const excerpt = internal ? "+const poolSize = 2;" : "+<button>Create request</button>";
  return { status: "analyzed", bytes: 0, bundle: {
    repository: "https://github.com/example/project", base: "a".repeat(40), head: "b".repeat(40), limited: false, notice: "Selected pinned evidence",
    inventory: [{ path: "form.tsx", previousPath: null, kind: "modified" }],
    evidence: [{ id: "p1", path: "form.tsx", side: "patch", commitId: null, changed: true, status: "included",
      text: `@@ -1 +1 @@\n-${internal ? "const poolSize = 1;" : "<button>Submit</button>"}\n${excerpt}` }],
  }, analysis: { assessment: internal ? "internal-only" : "product-change", uncertainties: [], findings: [{
    kind: internal ? "internal-change" : "behavior-modified", description: internal ? "Internal pool configuration changed" : "The form button label changed",
    before: internal ? "Pool size 1" : "Submit", after: internal ? "Pool size 2" : "Create request",
    support: "directly-supported", confidence: "high", confidenceReason: "Literal patch",
    citations: [{ evidenceId: "p1", startLine: 3, endLine: 3, excerpt }], reachabilityEvidenceIds: [], assumptions: [], uncertainties: [],
  }] } };
}
function runtime(): RuntimeVisualEvidence {
  return { captureId, artifactKey, requestedPathname: "/form", finalPathname: "/form", capturedAt: "2026-10-30T12:00:00.000Z",
    screenshotSha256: "c".repeat(64), vision: { model: "vision-fixture", elapsedMs: 12, data: {
      elements: [{ description: "Submit control", visibleText: "Create request", bounds: { xMin: 0.1, xMax: 0.5, yMin: 0.2, yMax: 0.3 }, certainty: "clear" }],
      observations: ["A Create request button is visible."], limitations: ["Interaction was not observed."],
    } } };
}
function output(internal = false): Output {
  return { assessment: internal ? "internal-only" : "product-change", summary: internal ? "Internal tuning only." : "The form now labels its submission control Create request.",
    claims: [{ description: internal ? "Internal tuning does not change supplied user-facing behavior." : "The form submission label changed.",
      kind: internal ? "internal-change" : "ui-change", confidence: "high", confidenceReason: "Direct static finding",
      before: internal ? null : "Submit", after: internal ? null : "Create request", uncertainties: [], references: ["source-1"] }],
    contradictions: [], uncertainties: [] };
}
function visualOutput(): Output {
  const value = output(); value.assessment = "insufficient-evidence";
  value.claims[0] = { ...value.claims[0], kind: "visual-observation", before: null, after: null, references: [visualId] };
  return value;
}
function provider(t: TestContext, response: unknown) {
  const old = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "fixture";
  t.after(() => { if (old === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = old; });
  let payload = "", instructions = "";
  const fetch = t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    assert.equal(url, "https://inference.baseten.co/v1/chat/completions");
    const body = JSON.parse(String(init.body)); payload = body.messages[1].content; instructions = body.messages[0].content;
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: typeof response === "string" ? response : JSON.stringify(response) } }] });
  });
  return { fetch, payload: () => JSON.parse(payload), instructions: () => instructions };
}

test("complete internal static evidence works without runtime in exactly one text call", async t => {
  const p = provider(t, output(true)); const result = await synthesizeProductImpact({ source: source(true) });
  assert.equal(result.impact.assessment, "internal-only"); assert.equal(p.fetch.mock.callCount(), 1);
  assert.equal(typeof result.model, "string"); assert.equal(typeof result.elapsedMs, "number");
  assert.equal(p.payload().runtimeCoverage, "unobserved");
  assert.match(p.instructions(), /Missing runtime means unobserved, not no UI impact/);
  assert.deepEqual(result.impact.provenance.sourceReferences[0].finding.citations, source(true).analysis!.findings[0].citations);
});

test("static and visual evidence retain server-owned provenance without leaking artifact identity to Baseten", async t => {
  const generated = output(); generated.claims[0].references.push(visualId); generated.uncertainties = Array(5).fill("Known limitation");
  const p = provider(t, generated); const result = await synthesizeProductImpact({ source: source(), runtime: [runtime()] });
  assert.equal(p.fetch.mock.callCount(), 1); assert.equal(result.impact.assessment, "product-change");
  assert.equal(result.impact.uncertainties.length, 6); assert.equal(result.impact.uncertainties[5], RUNTIME_REVISION_WARNING);
  assert.equal(result.impact.provenance.captures[0].artifactKey, artifactKey);
  assert.equal("data" in result.impact.provenance.captures[0].vision, false);
  assert.deepEqual(result.impact.provenance.visualReferences[0], { id: visualId, captureId, collection: "elements", index: 0 });
  const payload = p.payload(); assert.equal(payload.runtimeRevisionLimitation, RUNTIME_REVISION_WARNING);
  assert.equal(JSON.stringify(payload).includes(artifactKey), false); assert.equal(JSON.stringify(payload).includes("artifactKey"), false);
  assert.equal(payload.source.findings[0].id, "source-1"); assert.equal(payload.source.findings[0].citations, undefined);
  assert.equal(payload.source.findings[0].evidence[0].excerpt, source().analysis!.findings[0].citations[0].excerpt);
  assert.deepEqual(Object.keys(result.impact.claims[0]).sort(), Object.keys(generated.claims[0]).sort());
});

test("missing runtime leaves UI change analyzable without manufacturing visual observation", async t => {
  const p = provider(t, output()); const result = await synthesizeProductImpact({ source: source() });
  assert.equal(result.impact.assessment, "product-change"); assert.deepEqual(result.impact.uncertainties, []);
  assert.deepEqual(result.impact.provenance.captures, []); assert.equal(p.payload().runtimeRevisionLimitation, null);
});

test("visual support establishes current rendered state only", async t => {
  provider(t, visualOutput());
  const result = await synthesizeProductImpact({ source: source(), runtime: [runtime()] });
  assert.equal(result.impact.claims[0].kind, "visual-observation"); assert.equal(result.impact.claims[0].before, null);
  assert.deepEqual(result.impact.uncertainties, [RUNTIME_REVISION_WARNING]);
});

test("visual-only behavior, workflow, UI, internal or temporal claims fail", async t => {
  for (const kind of ["behavior-change", "workflow-change", "ui-change", "internal-change", "visual-observation"] as const) {
    await t.test(kind, async t => {
      const value = visualOutput(); value.claims[0].kind = kind;
      if (kind === "visual-observation") value.claims[0].after = "Create request";
      provider(t, value); await assert.rejects(synthesizeProductImpact({ source: source(), runtime: [runtime()] }));
    });
  }
});

test("temporal values must match the same appropriate source finding", async t => {
  for (const mutation of ["invented", "mixed", "wrong-kind"] as const) {
    await t.test(mutation, async t => {
      const input = source(); const value = output();
      if (mutation === "invented") value.claims[0].before = "A fabricated previous state";
      if (mutation === "mixed") {
        const second = structuredClone(input.analysis!.findings[0]); second.before = "Other before"; second.after = "Other after";
        input.analysis!.findings.push(second); value.claims[0].references.push("source-2"); value.claims[0].after = "Other after";
      }
      if (mutation === "wrong-kind") value.claims[0].kind = "workflow-change";
      provider(t, value); await assert.rejects(synthesizeProductImpact({ source: input }));
    });
  }
});

test("internal-only needs complete coverage and existing static internal-only assessment", async t => {
  for (const limited of [false, true]) await t.test(String(limited), async t => {
    const input = source(true); input.bundle.limited = limited; input.status = "insufficient-evidence";
    input.analysis!.assessment = "insufficient-evidence";
    provider(t, output(true)); await assert.rejects(synthesizeProductImpact({ source: input }), /unsupported-internal-only/);
  });
});

test("internal temporal values may only come from the same internal finding", async t => {
  const value = output(true); value.claims[0].before = "Pool size 1"; value.claims[0].after = "Pool size 2";
  provider(t, value); const result = await synthesizeProductImpact({ source: source(true) });
  assert.equal(result.impact.claims[0].after, "Pool size 2");
});

test("unresolved contradictions require both evidence kinds and insufficient assessment", async t => {
  const contradiction = { description: "Static label differs from the captured label.", status: "unresolved" as const, references: ["source-1", visualId] };
  await t.test("valid disagreement preserves uncertainty and provenance", async t => {
    const value = output(); value.assessment = "insufficient-evidence"; value.contradictions = [contradiction];
    provider(t, value); const result = await synthesizeProductImpact({ source: source(), runtime: [runtime()] });
    assert.deepEqual(result.impact.contradictions, [contradiction]); assert.deepEqual(result.impact.uncertainties, [RUNTIME_REVISION_WARNING]);
  });
  for (const variant of ["source-only", "visual-only", "wrong-assessment"]) await t.test(variant, async t => {
    const value = output(); value.assessment = "insufficient-evidence"; const input = source();
    value.contradictions = [structuredClone(contradiction)];
    if (variant === "source-only") {
      input.analysis!.findings.push(structuredClone(input.analysis!.findings[0]));
      value.contradictions[0].references = ["source-1", "source-2"];
    }
    if (variant === "visual-only") value.contradictions[0].references = [visualId, `visual:${captureId}:observations:0`];
    if (variant === "wrong-assessment") value.assessment = "product-change";
    provider(t, value); await assert.rejects(synthesizeProductImpact({ source: input, runtime: [runtime()] }));
  });
});

test("fabricated references, captures, collections, indices and limitations cannot support claims", async t => {
  for (const reference of ["source-99", `visual:${artifactKey}:elements:0`, `visual:${captureId}:limitations:0`, `visual:${captureId}:elements:99`, "invented"]) {
    await t.test(reference, async t => {
      const value = visualOutput(); value.claims[0].references = [reference]; provider(t, value);
      await assert.rejects(synthesizeProductImpact({ source: source(), runtime: [runtime()] }), /unknown-reference/);
    });
  }
});

test("invalid sources, citations, upstream errors and no-change never invoke Baseten", async t => {
  const p = provider(t, output());
  const invalid = source(); invalid.analysis!.findings[0].citations[0].excerpt = "not in evidence";
  const upstream = source(); upstream.status = "error"; upstream.error = "failed"; upstream.analysis = null;
  const unchanged = source(); unchanged.status = "no-change"; unchanged.analysis = null; unchanged.bundle.inventory = []; unchanged.bundle.evidence = [];
  const unpinned = source(); unpinned.bundle.evidence[0].commitId = "c".repeat(40);
  for (const input of [invalid, upstream, unchanged, unpinned, { ...source(), extra: true }]) {
    await assert.rejects(synthesizeProductImpact({ source: input }));
  }
  assert.equal(p.fetch.mock.callCount(), 0);
});

test("runtime projection is strict, bounded and locally validated before inference", async t => {
  const p = provider(t, output());
  const badBox = runtime(); badBox.vision.data.elements[0].bounds!.xMax = 2;
  const duplicate = [runtime(), runtime()];
  for (const captures of [[{ ...runtime(), dom: "forbidden" }], [badBox], duplicate, Array(4).fill(runtime())]) {
    await assert.rejects(synthesizeProductImpact({ source: source(), runtime: captures }));
  }
  assert.equal(p.fetch.mock.callCount(), 0);
});

test("malformed/unknown output, missing support and bounds fail local validation", async t => {
  const variants: unknown[] = ["{", { ...output(), extra: true }, { ...output(), summary: " " }, { ...output(), claims: Array(7).fill(output().claims[0]) },
    { ...output(), uncertainties: Array(7).fill("Too many") }, { ...output(), claims: [{ ...output().claims[0], description: "x".repeat(501) }] },
    { ...output(), claims: [{ ...output().claims[0], references: [] }] }, { ...output(), claims: [] },
    { ...output(), claims: [{ ...output().claims[0], citations: [] }] }];
  for (const [index, value] of variants.entries()) await t.test(String(index), async t => {
    const p = provider(t, value); await assert.rejects(synthesizeProductImpact({ source: source() })); assert.equal(p.fetch.mock.callCount(), 1);
  });
});

test("complete UTF-8 request overflow blocks inference without truncation", async t => {
  const captures = [runtime(), runtime(), runtime()].map((capture, index) => ({ ...capture, captureId: `11111111-1111-4111-8111-11111111111${index}` }));
  for (const capture of captures) {
    capture.vision.data.elements = Array.from({ length: 20 }, () => ({ description: "é".repeat(300), visibleText: "é".repeat(500), bounds: null, certainty: "uncertain" }));
    capture.vision.data.observations = Array(10).fill("é".repeat(500)); capture.vision.data.limitations = Array(10).fill("é".repeat(500));
  }
  const p = provider(t, output()); await assert.rejects(synthesizeProductImpact({ source: source(), runtime: captures }), /request-over-budget/);
  assert.equal(p.fetch.mock.callCount(), 0);
});

test("runtime warning slot is reserved even if the generated output omits the warning", async t => {
  const value = visualOutput(); value.uncertainties = Array(6).fill("qualification");
  provider(t, value); await assert.rejects(synthesizeProductImpact({ source: source(), runtime: [runtime()] }), /schema-mismatch/);
});

test("provider failure remains a provider failure without another call", async t => {
  const p = provider(t, output()); p.fetch.mock.mockImplementation(async () => new Response(null, { status: 401 }));
  await assert.rejects(synthesizeProductImpact({ source: source() }), /unauthorized/);
  assert.equal(p.fetch.mock.callCount(), 1);
});

test("cancellation is checked before validation and forwarded during the single call", async t => {
  const p = provider(t, output()); const early = new AbortController(); const reason = new Error("cancelled"); early.abort(reason);
  await assert.rejects(synthesizeProductImpact({ source: source() }, { signal: early.signal }), error => error === reason);
  assert.equal(p.fetch.mock.callCount(), 0);
  const active = new AbortController();
  p.fetch.mock.mockImplementation(async (_url: unknown, init: RequestInit) => {
    assert.ok(init.signal); const waiting = new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
    active.abort(); return waiting;
  });
  await assert.rejects(synthesizeProductImpact({ source: source() }, { signal: active.signal }), /cancelled/);
  assert.equal(p.fetch.mock.callCount(), 1);
});

test("retained ProductImpact graph validation accepts synthesis output and rejects broken catalog correspondence", async t => {
  const generated = output(); generated.claims[0].references.push(visualId);
  provider(t, generated); const { impact } = await synthesizeProductImpact({ source: source(), runtime: [runtime()] });
  assert.deepEqual(validateProductImpact(impact), impact);
  const mutations: ((input: ProductImpact) => void)[] = [
    input => { input.provenance.source.base = "z".repeat(40); },
    input => { input.provenance.sourceReferences[0].findingIndex = 2; },
    input => { input.provenance.sourceReferences[0].finding.citations[0].endLine = 1; },
    input => { input.provenance.sourceEvidence.push({ ...input.provenance.sourceEvidence[0], id: "uncited" }); },
    input => { input.provenance.captures.push(input.provenance.captures[0]); },
    input => { input.provenance.visualReferences.push(input.provenance.visualReferences[0]); },
    input => { input.provenance.visualReferences[0].index = 20; },
    input => { input.provenance.visualReferences[0].id = "invented"; },
    input => { input.claims[0].references = ["unknown"]; },
    input => { input.claims[0].references.push("source-1"); },
    input => { input.claims[0].before = "Invented prior state"; },
    input => { input.claims[0].references = [visualId]; },
    input => { input.assessment = "internal-only"; },
    input => { input.contradictions = [{ description: "Mismatch", status: "unresolved", references: ["source-1", visualId] }]; },
    input => { input.uncertainties = []; },
  ];
  for (const mutation of mutations) { const input = structuredClone(impact); mutation(input); assert.throws(() => validateProductImpact(input)); }
});
