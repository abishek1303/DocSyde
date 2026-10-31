import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { ProductImpact } from "@/features/sources/product-analysis";
import type { DocumentationDocument } from "./document";
import { documentationImpactOutputSchema } from "./documentation-impact";
import { draftFixture } from "../../../infra/local/documentation/draft-fixture";
import { RUNTIME_REVISION_WARNING } from "@/features/sources/runtime-visual-evidence";
import type { z } from "zod";

type Output = z.infer<typeof documentationImpactOutputSchema>;
const repository = "https://github.com/abishek1303/DocSyde";
const load = createRequire(join(process.cwd(), "package.json"));
const databasePath = load.resolve("./src/integrations/database/documentation-drafts.ts");
const operationPath = load.resolve("./src/features/documentation/operations.ts");
const inputPath = load.resolve("./src/features/documentation/documentation-impact-input.ts");
const plannerPath = load.resolve("./src/features/documentation/plan-documentation-impact.ts");
const queries: typeof import("@/integrations/database/documentation-drafts") = load(databasePath);
const captureId = "11111111-1111-4111-8111-111111111111";
const artifactKey = "22222222-2222-4222-8222-222222222222";
const visualRef = `visual:${captureId}:observations:0`;

function impact(internal = false): ProductImpact {
  const finding = { kind: internal ? "internal-change" as const : "field-requirement-changed" as const,
    description: internal ? "Pool size changed" : "The request title is now required", before: internal ? "1" : "Optional", after: internal ? "2" : "Required",
    support: "directly-supported" as const, confidence: "high" as const, confidenceReason: "Literal source finding",
    citations: [{ evidenceId: "patch-1", startLine: 1, endLine: 1, excerpt: "+required" }], reachabilityEvidenceIds: [], assumptions: [], uncertainties: [] };
  return { assessment: internal ? "internal-only" : "product-change", summary: finding.description,
    claims: [{ description: finding.description, kind: internal ? "internal-change" : "behavior-change", confidence: "high",
      confidenceReason: "Literal source finding", before: finding.before, after: finding.after, uncertainties: ["Review scope"], references: ["source-1"] }],
    contradictions: [], uncertainties: ["Selected source only"], provenance: {
      source: { repository, base: "a".repeat(40), head: "b".repeat(40), limited: false, notice: "Pinned selection", uncertainties: ["Source qualification"] },
      sourceReferences: [{ id: "source-1", findingIndex: 0, finding }],
      sourceEvidence: [{ id: "patch-1", path: "form.ts", side: "patch", commitId: null, contentId: null }], captures: [], visualReferences: [],
    } };
}
function withVisual(input = impact()): ProductImpact {
  input.provenance.captures = [{ captureId, artifactKey, requestedPathname: "/fixture", finalPathname: "/fixture",
    capturedAt: "2026-10-30T00:00:00.000Z", screenshotSha256: "c".repeat(64), vision: { model: "vision-fixture", elapsedMs: 1 } }];
  input.provenance.visualReferences = [{ id: visualRef, captureId, collection: "observations", index: 0 }];
  input.claims[0].references.push(visualRef); input.uncertainties.push(RUNTIME_REVISION_WARNING); return input;
}
function decision(document: DocumentationDocument | null, action: Output["decisions"][number]["action"] = "revise", sectionId: string | null = null): Output {
  return { decisions: [{ action, documentId: document?.id ?? null, sectionId, reason: "The supplied claim changes this documented requirement.",
    updateIntent: "Make the documented title requirement accurate.", claimRefs: ["claim-1"] }], uncertainties: [] };
}
type Row = { id: string; document: unknown; savedAt: Date };
function setup(t: TestContext, documents: DocumentationDocument[], output: unknown) {
  const rows: Row[] = documents.map(document => ({ id: document.id, document, savedAt: new Date("2026-10-30T00:00:00Z") }));
  const databaseModule = load.cache[databasePath]; assert.ok(databaseModule);
  const original = databaseModule.exports;
  const paths = [operationPath, inputPath, plannerPath];
  const cached = paths.map(path => [path, load.cache[path]] as const);
  const list = t.mock.fn(async (limit: number, before?: unknown, selectedRepository?: string) => {
    assert.equal(limit, 11); assert.equal(before, undefined); assert.equal(selectedRepository?.toLowerCase(), repository.toLowerCase()); return rows;
  });
  const get = t.mock.fn(async (id: string, selectedRepository?: string) => {
    assert.equal(selectedRepository?.toLowerCase(), repository.toLowerCase()); return rows.find(row => row.id === id) ?? null;
  });
  // Scoped module replacement follows existing local orchestration tests; the
  // actual persistence feature operations still validate/query canonical rows.
  databaseModule.exports = { ...queries, selectDocumentationDrafts: list, findDocumentationDraft: get,
    insertDocumentationDraft: () => { throw new Error("Planning must not save"); } };
  for (const path of paths) delete load.cache[path];
  const oldKey = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "fixture";
  t.after(() => {
    databaseModule.exports = original;
    for (const [path, module] of cached) { if (module) load.cache[path] = module; else delete load.cache[path]; }
    if (oldKey === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = oldKey;
  });
  let body: { messages: { content: string }[] } | undefined;
  const fetch = t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    assert.equal(url, "https://inference.baseten.co/v1/chat/completions"); body = JSON.parse(String(init.body));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: typeof output === "string" ? output : JSON.stringify(output) } }] });
  });
  const { planDocumentationImpact }: typeof import("./plan-documentation-impact") = load(plannerPath);
  return { planDocumentationImpact, rows, list, get, fetch,
    payload: () => JSON.parse(body!.messages[1].content), instructions: () => body!.messages[0].content };
}

test("exact document/section targets preserve immutable IDs and upstream qualifications in one text call", async t => {
  for (const section of [false, true]) await t.test(String(section), async t => {
    const document = draftFixture(), input = withVisual();
    const expected = decision(document, "revise", section ? document.sections[0].id : null);
    const p = setup(t, [document], expected); const original = JSON.stringify(p.rows);
    const result = await p.planDocumentationImpact({ impact: input });
    assert.deepEqual(result.plan.decisions, expected.decisions); assert.equal(p.fetch.mock.callCount(), 1);
    assert.equal(JSON.stringify(p.rows), original); assert.equal(typeof result.model, "string"); assert.equal(typeof result.elapsedMs, "number");
    assert.deepEqual(p.list.mock.calls[0].arguments, [11, undefined, repository]);
    assert.deepEqual(p.get.mock.calls[0].arguments, [document.id, repository]);
    assert.deepEqual(result.plan.claimCatalog, [{ id: "claim-1", claimIndex: 0, claim: input.claims[0] }]);
    assert.deepEqual(result.plan.qualifications.uncertainties, input.uncertainties);
    assert.deepEqual(result.plan.qualifications.source, { limited: false, notice: "Pinned selection", uncertainties: ["Source qualification"] });
    assert.equal(result.plan.claimCatalog[0].claim.references.includes(visualRef), true);
    const serialized = JSON.stringify(p.payload());
    for (const forbidden of [artifactKey, captureId, "screenshotSha256", "sourceReferences", "sourceEvidence", "factRefs", "analysisId", "vision-fixture"]) assert.equal(serialized.includes(forbidden), false, forbidden);
    assert.equal(p.payload().documents[0].sections[0].id, document.sections[0].id);
    assert.deepEqual(p.payload().documents[0].routes, ["/fixture"]);
    assert.match(p.instructions(), /immutable snapshots/); assert.match(p.instructions(), /untrusted DATA/);
  });
});

test("unknown/mismatched document, section and claim references reject", async t => {
  for (const variant of ["document", "section", "mismatch", "claim", "duplicate-claim", "section-without-document"]) await t.test(variant, async t => {
    const first = draftFixture(), second = draftFixture(); const out = decision(first);
    if (variant === "document") out.decisions[0].documentId = captureId;
    if (variant === "section") out.decisions[0].sectionId = captureId;
    if (variant === "mismatch") out.decisions[0].sectionId = second.sections[0].id;
    if (variant === "claim") out.decisions[0].claimRefs = ["claim-2"];
    if (variant === "duplicate-claim") out.decisions[0].claimRefs = ["claim-1", "claim-1"];
    if (variant === "section-without-document") { out.decisions[0].documentId = null; out.decisions[0].sectionId = first.sections[0].id; }
    const p = setup(t, [first, second], out); await assert.rejects(p.planDocumentationImpact({ impact: impact() }));
    assert.equal(p.fetch.mock.callCount(), 1);
  });
});

test("add-section and add-document are distinct supported planning intents, never new IDs", async t => {
  for (const newDocument of [false, true]) await t.test(String(newDocument), async t => {
    const document = draftFixture(); const out = decision(newDocument ? null : document, "add");
    out.decisions[0].reason = "The supplied new requirement needs explanation; the supplied sections describe only the previous optional field.";
    const p = setup(t, [document], out); const result = await p.planDocumentationImpact({ impact: impact() });
    assert.equal(result.plan.decisions[0].documentId, newDocument ? null : document.id); assert.equal(result.plan.decisions[0].sectionId, null);
  });
  await t.test("existing section cannot masquerade as a new section", async t => {
    const document = draftFixture(); const p = setup(t, [document], decision(document, "add", document.sections[0].id));
    await assert.rejects(p.planDocumentationImpact({ impact: impact() }));
  });
});

test("empty complete retrieval does not itself establish a coverage gap", async t => {
  const out = decision(null, "unresolved"); out.decisions[0].reason = "No saved documents are present, but a supported documentation need has not been established.";
  const p = setup(t, [], out); const result = await p.planDocumentationImpact({ impact: impact() });
  assert.equal(result.plan.decisions[0].action, "unresolved"); assert.deepEqual(p.payload().documents, []);
  assert.equal(p.payload().candidateCoverage, "complete"); assert.match(p.instructions(), /empty complete candidate set alone does not justify add/);
});

test("a supported user-facing documentation need can justify add even with no saved candidates", async t => {
  const out = decision(null, "add");
  out.decisions[0].reason = "The source-supported mandatory title affects request creation; users need guidance about the changed requirement, and no supplied document covers it.";
  const p = setup(t, [], out); const result = await p.planDocumentationImpact({ impact: impact() });
  assert.equal(result.plan.decisions[0].action, "add"); assert.equal(result.plan.decisions[0].documentId, null);
  assert.match(p.instructions(), /Every add needs a supported product\/documentation coverage gap/);
});

test("positive no-change needs a real target and supplied claims", async t => {
  await t.test("accurate text", async t => {
    const document = draftFixture(); document.sections[0].content[0].markdown = "The request title is required.";
    const out = decision(document, "no-change"); out.decisions[0].reason = "The existing requirement already matches the supplied changed fact."; out.decisions[0].updateIntent = "";
    const p = setup(t, [document], out); assert.equal((await p.planDocumentationImpact({ impact: impact() })).plan.decisions[0].action, "no-change");
    assert.match(p.instructions(), /positive evidence/);
  });
  for (const action of ["revise", "no-change"] as const) await t.test(`missing target ${action}`, async t => {
    const p = setup(t, [], decision(null, action)); await assert.rejects(p.planDocumentationImpact({ impact: impact() }), /existing target/);
  });
});

test("internal-only normally leaves docs unchanged; explicitly documented internal behavior may need revision", async t => {
  for (const documented of [false, true]) await t.test(String(documented), async t => {
    const document = draftFixture();
    if (documented) document.sections[0].content[0].markdown = "Internal pool configuration: the pool size is 1.";
    const out = decision(document, documented ? "revise" : "no-change", document.sections[0].id);
    out.decisions[0].reason = documented ? "The existing Internal pool configuration text explicitly describes the changed pool setting." : "The supplied user-facing requirement remains accurate; it does not describe the internal pool setting.";
    out.decisions[0].updateIntent = documented ? "Align the internal pool-size description with the changed setting." : "";
    const p = setup(t, [document], out); assert.equal((await p.planDocumentationImpact({ impact: impact(true) })).plan.decisions[0].action, documented ? "revise" : "no-change");
    assert.match(p.instructions(), /only if supplied existing text explicitly documents the changed internal behavior/);
  });
});

test("insufficient evidence and material contradictions permit only unresolved, preserving upstream warnings", async t => {
  for (const conflict of [false, true]) await t.test(String(conflict), async t => {
    const input = withVisual(); input.assessment = "insufficient-evidence";
    if (conflict) input.contradictions = [{ description: "Rendered state disagrees with supplied static evidence.", status: "unresolved", references: ["source-1", visualRef] }];
    const document = draftFixture(), out = decision(document, "unresolved");
    const p = setup(t, [document], out); const result = await p.planDocumentationImpact({ impact: input });
    assert.deepEqual(result.plan.qualifications.contradictions, input.contradictions); assert.deepEqual(result.plan.qualifications.uncertainties, input.uncertainties);
    assert.equal(JSON.stringify(p.payload()).includes(captureId), false);
    for (const action of ["revise", "add", "no-change"] as const) {
      out.decisions[0].action = action; await assert.rejects(p.planDocumentationImpact({ impact: input }), /requires unresolved/);
    }
  });
});

test("visual-only claims cannot justify revise/add even when another source-supported claim exists", async t => {
  for (const action of ["revise", "add"] as const) await t.test(action, async t => {
    const input = withVisual(); input.claims.push({ ...input.claims[0], kind: "visual-observation", before: null, after: null, references: [visualRef] });
    const document = draftFixture(), out = decision(document, action); out.decisions[0].claimRefs = ["claim-2"];
    const p = setup(t, [document], out); await assert.rejects(p.planDocumentationImpact({ impact: input }), /source-supported/);
  });
});

test("ambiguous overlapping snapshots remain unresolved without recency-based authority", async t => {
  const first = draftFixture(), second = draftFixture(); const out = decision(null, "unresolved");
  out.decisions[0].reason = "Both snapshots cover the requirement, without metadata identifying the appropriate transformation target.";
  const p = setup(t, [second, first], out); const result = await p.planDocumentationImpact({ impact: impact() });
  assert.equal(result.plan.decisions[0].action, "unresolved");
  assert.deepEqual(p.payload().documents.map((document: { id: string }) => document.id), [first.id, second.id].sort());
  assert.match(p.instructions(), /ambiguous overlapping/); assert.equal(JSON.stringify(p.payload()).includes("savedAt"), false);
});

test("incomplete listing, unavailable/corrupt/disappearing/mismatched rows reject before inference", async t => {
  for (const variant of ["pagination", "corrupt-list", "corrupt-load", "disappeared", "list-repository", "load-repository", "load-id"] as const) await t.test(variant, async t => {
    const document = draftFixture(), p = setup(t, [document], decision(document));
    if (variant === "pagination") p.rows.push(...Array.from({ length: 10 }, () => { const document = draftFixture(); return { id: document.id, document, savedAt: new Date() }; }));
    if (variant === "corrupt-list") p.rows[0].document = { id: document.id };
    if (variant === "corrupt-load") p.get.mock.mockImplementation(async () => ({ ...p.rows[0], document: { id: document.id } }));
    if (variant === "disappeared") p.get.mock.mockImplementation(async () => null);
    if (variant === "list-repository") document.provenance.repository = "https://github.com/other/product";
    if (variant === "load-repository") p.get.mock.mockImplementation(async () => ({ ...p.rows[0], document: { ...document, provenance: { ...document.provenance, repository: "https://github.com/other/product" } } }));
    if (variant === "load-id") p.get.mock.mockImplementation(async () => ({ ...p.rows[0], document: { ...document, id: captureId } }));
    await assert.rejects(p.planDocumentationImpact({ impact: impact() })); assert.equal(p.fetch.mock.callCount(), 0);
  });
});

test("malformed ProductImpact graphs and zero claims reject before any retrieval or model access", async t => {
  const mutations: ((input: ProductImpact) => void)[] = [
    input => { input.claims = []; input.assessment = "insufficient-evidence"; },
    input => { input.claims[0].references = ["source-99"]; },
    input => { input.provenance.sourceReferences.push(input.provenance.sourceReferences[0]); },
    input => { input.provenance.sourceEvidence = []; },
    input => { input.provenance.sourceEvidence[0].commitId = "c".repeat(40); },
    input => { input.provenance.visualReferences[0].captureId = artifactKey; },
    input => { input.uncertainties = []; },
  ];
  const p = setup(t, [], decision(null, "unresolved"));
  for (const mutation of mutations) { const input = withVisual(); mutation(input); await assert.rejects(p.planDocumentationImpact({ impact: input })); }
  assert.equal(p.list.mock.callCount(), 0); assert.equal(p.get.mock.callCount(), 0); assert.equal(p.fetch.mock.callCount(), 0);
});

test("strict malformed/unknown output and count/text bounds fail without repair calls", async t => {
  const document = draftFixture();
  for (const out of ["{", { ...decision(document), extra: true }, { ...decision(document), qualifications: {} },
    { ...decision(document), decisions: Array(9).fill(decision(document).decisions[0]) },
    { ...decision(document), uncertainties: Array(7).fill("Too many") },
    { ...decision(document), decisions: [{ ...decision(document).decisions[0], reason: "x".repeat(501) }] },
    { ...decision(document), decisions: [{ ...decision(document).decisions[0], claimRefs: [] }] },
  ]) await t.test(JSON.stringify(out).slice(0, 45), async t => {
    const p = setup(t, [document], out); await assert.rejects(p.planDocumentationImpact({ impact: impact() })); assert.equal(p.fetch.mock.callCount(), 1);
  });
});

test("complete UTF-8 request overflow rejects without omitting saved content", async t => {
  const documents = Array.from({ length: 5 }, () => draftFixture());
  for (const document of documents) for (const section of document.sections) for (const block of section.content) block.markdown = "界".repeat(1500);
  const p = setup(t, documents, decision(documents[0])); await assert.rejects(p.planDocumentationImpact({ impact: impact() }), /32 KiB/);
  assert.equal(p.get.mock.callCount(), 5); assert.equal(p.fetch.mock.callCount(), 0);
});

test("cancellation stops before retrieval, between reads and during the single model call", async t => {
  const document = draftFixture(), p = setup(t, [document], decision(document)); const early = new AbortController(); const reason = new Error("cancelled"); early.abort(reason);
  await assert.rejects(p.planDocumentationImpact({ impact: impact() }, { signal: early.signal }), error => error === reason);
  assert.equal(p.list.mock.callCount(), 0);
  const between = new AbortController(); p.get.mock.mockImplementation(async () => { between.abort(reason); return p.rows[0]; });
  await assert.rejects(p.planDocumentationImpact({ impact: impact() }, { signal: between.signal }), error => error === reason);
  assert.equal(p.fetch.mock.callCount(), 0); p.get.mock.mockImplementation(async () => p.rows[0]);
  const active = new AbortController(); p.fetch.mock.mockImplementation(async (_url: unknown, init: RequestInit) => {
    const pending = new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true })); active.abort(); return pending;
  });
  await assert.rejects(p.planDocumentationImpact({ impact: impact() }, { signal: active.signal }), /cancelled/);
  assert.equal(p.fetch.mock.callCount(), 1);
});
