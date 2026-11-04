import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDatabase, closeDatabase } from "@/integrations/database/client";
import { documentationDrafts, documentationReviews, documentationPublications, documentationPublicationHistory } from "@/integrations/database/schema";
import { saveDocumentationDraft } from "@/features/documentation/documents/operations";
import { retainDocumentationProposal } from "@/features/documentation/review/review-proposal-operations";
import { getPendingWorkspace, discardPendingWorkspace, getProposalPendingReadiness } from "@/features/documentation/review/pending-workspace";
import { validateDocumentationImpactPlan } from "@/features/documentation/planning/validate-documentation-impact-plan";
import { discoverProductRoutes } from "@/features/sources/runtime/discover-product-routes";
import type { ProductBundle } from "@/features/sources/analysis/product-change-analysis";
import type { TransformationAuthorization } from "@/features/documentation/transformation/transformation-input";
import { transformationImpactFixture, transformationDecisionFixture, transformationEntryFixture } from "./transformation-fixtures";
import { draftFixture } from "./draft-fixture";

test("Full Scan generates identical fresh inputs across documentation histories and matches publication only after support", async t => {
  const name = `fresh-${randomUUID()}/product`, repository = `https://github.com/${name}`;
  const prior = process.env.DOCSYDE_ANALYSIS_REPOSITORIES; process.env.DOCSYDE_ANALYSIS_REPOSITORIES = name;
  t.after(async () => { try {
    for (const table of [documentationReviews, documentationPublications, documentationPublicationHistory]) await getDatabase().delete(table).where(eq(table.repository, repository));
    await getDatabase().delete(documentationDrafts).where(sql`${documentationDrafts.document}->'provenance'->>'repository' = ${repository}`);
  } finally { await closeDatabase(); if (prior === undefined) delete process.env.DOCSYDE_ANALYSIS_REPOSITORIES; else process.env.DOCSYDE_ANALYSIS_REPOSITORIES = prior; } });
  t.mock.method(globalThis, "fetch", () => { throw new Error("No network or live inference"); });
  const impact = transformationImpactFixture();
  impact.provenance.source.repository = repository; impact.provenance.source.base = impact.provenance.source.head; impact.provenance.source.limited = true;
  const finding = impact.provenance.sourceReferences[0].finding;
  finding.kind = "product-behavior"; finding.before = null; finding.after = null; finding.description = "A request title is required";
  impact.claims[0].before = null; impact.claims[0].after = null; impact.claims[0].description = finding.description;
  impact.provenance.sourceEvidence[0] = { ...impact.provenance.sourceEvidence[0], path: "app/page.tsx", side: "head", commitId: impact.provenance.source.head };
  const files = { "package.json": '{"dependencies":{"next":"16"}}', "app/page.tsx": "export default function Requests(){return <h1>Requests</h1>}" };
  const bundle: ProductBundle = { mode: "current-state", repository, base: impact.provenance.source.head, head: impact.provenance.source.head, limited: true, notice: "Bounded fixture",
    inventory: Object.keys(files).map(path => ({ path, previousPath: null, kind: "current-file" })), evidence: Object.entries(files).map(([path, text], i) => ({ id: `snapshot-${i}`, path, text, side: "head", commitId: impact.provenance.source.head, changed: false, status: "available" })) };
  const routes = discoverProductRoutes(bundle);
  const load = createRequire(import.meta.url), restores: (() => void)[] = [];
  const planning: string[] = [], generation: string[] = [];
  let supported = true;
  const replacements = [
    ["../../../src/integrations/ai/generate-structured.ts", { generateStructured: async (request: { input: string; schema: { parse(value: unknown): unknown }; invocation: { operation: string } }) => {
      const input = JSON.parse(request.input), operation = request.invocation.operation;
      let data: unknown;
      if (operation === "documentation-planning") {
        planning.push(request.input);
        data = { decisions: [transformationDecisionFixture(null, null, input.objective === "fresh" ? "add" : "unresolved")], uncertainties: [] };
      } else if (operation === "documentation-transformation") {
        generation.push(request.input); assert.deepEqual(input.documents, []);
        data = { entries: input.authorizations.map((auth: TransformationAuthorization) => transformationEntryFixture(auth, [])) };
      } else data = { verdicts: input.units.map((unit: { id: string }) => ({ unitId: unit.id, verdict: supported ? "supported" : "unsupported", reason: "Fixture support verdict" })) };
      return { data: request.schema.parse(data), model: "mock-no-inference", elapsedMs: 1 };
    } }],
    ["../../../src/integrations/ai/invocation-log.ts", { validateInvocation: async (_id: unknown, validate: () => unknown) => validate(), finishInvocationValidation: async () => {} }],
  ] as const;
  for (const [path, replacement] of replacements) { const resolved = load.resolve(path), original = load(resolved), cached = load.cache[resolved]!; cached.exports = { ...original, ...replacement }; restores.push(() => { cached.exports = original; }); }
  t.after(() => restores.forEach(restore => restore()));
  const { planDocumentationImpact }: typeof import("@/features/documentation/planning/plan-documentation-impact") = load("../../../src/features/documentation/planning/plan-documentation-impact.ts");
  const { transformDocumentation }: typeof import("@/features/documentation/transformation/transform-documentation") = load("../../../src/features/documentation/transformation/transform-documentation.ts");
  const generate = async () => {
    const { plan } = await planDocumentationImpact({ impact, objective: "fresh", routes });
    assert.equal(plan.objective, "fresh"); assert.equal(plan.decisions[0].action, "add");
    assert.equal(plan.candidateSelection, undefined, "no claim that a documentation corpus was searched");
    return transformDocumentation({ impact, plan, routes });
  };
  const initial = await generate();
  assert.equal(initial.candidates.length, 1); assert.deepEqual(initial.targets, []);
  const initialState = await retainDocumentationProposal(initial);
  assert.equal(initialState.targets[0].route, "/"); assert.equal(initialState.targets[0].observedId, null);
  assert.equal((await getPendingWorkspace({ repository: name })).count, 1);
  let pending = await getPendingWorkspace({ repository: name });
  assert.equal((await discardPendingWorkspace({ repository: name, expectedHash: pending.hash, confirmed: true })).status, "discarded");

  // Only isolated fixture metadata is seeded; no publication operation is executed.
  const old = draftFixture(); old.title = "Historical prose sentinel"; old.provenance.repository = repository; old.context[0].value = "/";
  await saveDocumentationDraft(old);
  const live = { id: randomUUID(), repository, route: "/", draftId: old.id };
  await getDatabase().insert(documentationPublications).values(live);
  await getDatabase().insert(documentationPublicationHistory).values({ ...live, id: randomUUID(), publishedAt: new Date() });
  const unpublished = draftFixture(); unpublished.title = "Unpublished prose sentinel"; unpublished.provenance.repository = repository; await saveDocumentationDraft(unpublished);
  const beforePublications = await getDatabase().select().from(documentationPublications).where(eq(documentationPublications.repository, repository));
  const beforeArchives = await getDatabase().select().from(documentationPublicationHistory).where(eq(documentationPublicationHistory.repository, repository));
  const fresh = await generate();
  assert.equal(planning[0], planning[1], "published, archived, discarded and unpublished history cannot affect fresh planning");
  assert.equal(generation[0], generation[1], "fresh generation requests are identical despite all documentation history");
  assert.deepEqual(Object.keys(JSON.parse(planning[1])).sort(), ["impact", "objective", "verifiedScreens"]);
  assert.ok(!generation[1].includes("Historical prose sentinel"));
  assert.deepEqual(fresh.targets, []); assert.notEqual(fresh.candidates[0].document.id, old.id);
  const replacement = await retainDocumentationProposal(fresh);
  assert.equal(replacement.targets[0].baselineId, old.id); assert.equal(replacement.targets[0].observedId, live.id);
  pending = await getPendingWorkspace({ repository: name }); assert.equal(pending.count, 1);
  assert.equal(pending.groups[0].document!.title, fresh.candidates[0].document.title);
  assert.deepEqual(await getDatabase().select().from(documentationPublications).where(eq(documentationPublications.repository, repository)), beforePublications);
  assert.deepEqual(await getDatabase().select().from(documentationPublicationHistory).where(eq(documentationPublicationHistory.repository, repository)), beforeArchives);
  await discardPendingWorkspace({ repository: name, expectedHash: pending.hash, confirmed: true });
  await planDocumentationImpact({ impact, context: [{ id: "route", kind: "route", value: "/", origin: "operator" }] });
  assert.ok(JSON.parse(planning[2]).documents.length, "Latest Changes remains documentation-aware");
  assert.throws(() => validateDocumentationImpactPlan(impact, { ...fresh.plan, decisions: [{ ...fresh.plan.decisions[0], action: "no-change" }] }), /Fresh planning/);
  supported = false;
  const unsupported = await generate(); assert.equal(unsupported.results[0].support, "unsupported");
  await retainDocumentationProposal(unsupported);
  assert.deepEqual((await getProposalPendingReadiness(name, unsupported.proposalId)).actionableDecisionIds, []);
  assert.equal((await getPendingWorkspace({ repository: name })).count, 0);
});
