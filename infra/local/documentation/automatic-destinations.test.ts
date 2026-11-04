import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDatabase, closeDatabase } from "@/integrations/database/client";
import { documentationDrafts, documentationReviews, documentationPublications, documentationPublicationHistory } from "@/integrations/database/schema";
import { discoverProductRoutes } from "@/features/sources/runtime/discover-product-routes";
import type { ProductBundle } from "@/features/sources/analysis/product-change-analysis";
import { transformationImpactFixture, transformationPlanFixture, transformationDecisionFixture, transformationEntryFixture } from "./transformation-fixtures";
import type { TransformationAuthorization } from "@/features/documentation/transformation/transformation-input";
import { discoveredAssociations } from "@/features/documentation/transformation/route-associations";
import { validateTransformationEntry } from "@/features/documentation/transformation/transformation-validation";
import { validateDocumentationProposal } from "@/features/documentation/transformation/validate-documentation-proposal";
import { validateDocumentationDocument } from "@/features/documentation/documents/document-validation";
import { retainDocumentationProposal, getDocumentationReview } from "@/features/documentation/review/review-proposal-operations";
import { getPendingWorkspace, getProposalPendingReadiness, publishPendingWorkspace, discardPendingWorkspace } from "@/features/documentation/review/pending-workspace";
import { destinationChoices, confirmDocumentationDestination } from "@/features/documentation/review/destination-resolution";
import { getContextualDocumentation } from "@/features/documentation/publication/publication-operations";
import { getDocumentationDraft } from "@/features/documentation/documents/operations";
import { reviewProposalFixture } from "./review-fixtures";

test("verified routes create publishable canonical documents; ambiguous screens require an audited confirmation", async t => {
  const name = `destinations-${randomUUID()}/product`, repository = `https://github.com/${name}`, owner = name.split("/")[0];
  const previous = process.env.DOCSYDE_ANALYSIS_REPOSITORIES; process.env.DOCSYDE_ANALYSIS_REPOSITORIES = name;
  t.after(async () => { try {
    await getDatabase().delete(documentationReviews).where(eq(documentationReviews.repository, repository));
    await getDatabase().delete(documentationPublications).where(eq(documentationPublications.repository, repository));
    await getDatabase().delete(documentationPublicationHistory).where(eq(documentationPublicationHistory.repository, repository));
    await getDatabase().delete(documentationDrafts).where(sql`${documentationDrafts.document}->'provenance'->>'repository' = ${repository}`);
  } finally { await closeDatabase(); if (previous === undefined) delete process.env.DOCSYDE_ANALYSIS_REPOSITORIES; else process.env.DOCSYDE_ANALYSIS_REPOSITORIES = previous; } });
  t.mock.method(globalThis, "fetch", () => { throw new Error("No paid inference or network allowed"); });
  const load = createRequire(import.meta.url), restores: (() => void)[] = [];
  for (const [path, replacement] of [
    ["../../../src/integrations/ai/generate-structured.ts", { generateStructured: async (request: { input: string; invocation: { operation: string } }) => {
      const input = JSON.parse(request.input);
      const data = request.invocation.operation === "documentation-transformation" ? { entries: input.authorizations.map((auth: TransformationAuthorization) => {
        const entry = transformationEntryFixture(auth, []); if (entry.change.kind === "add-document") entry.change.sections.push({ ...structuredClone(entry.change.sections[0]), title: "Another workflow on the same screen" }); return entry;
      }) } : { verdicts: input.units.map((unit: { id: string }) => ({ unitId: unit.id, verdict: "supported", reason: "Fixture source supports this block" })) };
      return { data, model: "mock-no-inference", elapsedMs: 1 };
    } }],
    ["../../../src/integrations/ai/invocation-log.ts", { finishInvocationValidation: async () => {} }],
    ["../../../src/integrations/ai/generate-composition.ts", { compositionConfigured: () => false }],
  ] as const) { const resolved = load.resolve(path), prior = load(resolved), cached = load.cache[resolved]!; cached.exports = { ...prior, ...replacement }; restores.push(() => { cached.exports = prior; }); }
  t.after(() => restores.forEach(restore => restore()));
  const { transformDocumentation }: typeof import("@/features/documentation/transformation/transform-documentation") = load("../../../src/features/documentation/transformation/transform-documentation.ts");
  const impact = transformationImpactFixture(); impact.provenance.source.repository = repository;
  const plan = transformationPlanFixture(impact, [transformationDecisionFixture(null, null, "add")]);
  const bundle = (files: Record<string, string>): ProductBundle => ({ mode: "current-state", repository, base: impact.provenance.source.head, head: impact.provenance.source.head, limited: true, notice: "Fixture routes", inventory: Object.keys(files).map(path => ({ path, kind: "current-file", previousPath: null })), evidence: Object.entries(files).map(([path, text], index) => ({ id: `snapshot-${index}`, path, side: "head", commitId: impact.provenance.source.head, text, status: "available", changed: false })) });
  const rootRoutes = discoverProductRoutes(bundle({ "package.json": '{"dependencies":{"next":"16"}}', "app/page.tsx": 'export default function Page(){return <h1>Home</h1>}' }));
  impact.provenance.sourceEvidence[0].path = "app/page.tsx";
  // Rebuild the immutable plan after fixture provenance changes.
  let currentPlan = transformationPlanFixture(impact, plan.decisions);
  const auto = await transformDocumentation({ impact, plan: currentPlan, routes: rootRoutes });
  validateDocumentationProposal(auto); assert.equal(auto.candidates[0].document.sections.length, 2);
  const auth = auto.authorizations[0], forged = transformationEntryFixture(auth, []); if (forged.change.kind === "add-document") forged.change.associations = ["/invented"];
  assert.throws(() => validateTransformationEntry(forged, auth), /Unauthorized/);
  const canonical = structuredClone(auto.candidates[0].document); canonical.context[0].routeEvidence!.commitId = "0".repeat(40);
  assert.throws(() => validateDocumentationDocument(canonical));
  const autoState = await retainDocumentationProposal(auto); assert.equal(autoState.targets[0].route, "/"); assert.equal(autoState.targets[0].requiresConfirmation, false);
  assert.deepEqual((await getProposalPendingReadiness(name, auto.proposalId)).actionableDecisionIds, ["decision-1"]);
  let pending = await getPendingWorkspace({ repository: name }); assert.equal(pending.count, 1);
  assert.equal((await getContextualDocumentation({ owner, repo: "product", route: "/" })).publication, null, "automatic association never publishes");
  assert.equal((await publishPendingWorkspace({ repository: name, expectedHash: pending.hash })).status, "published");
  assert.ok((await getContextualDocumentation({ owner, repo: "product", route: "/" })).publication);
  const routes = discoverProductRoutes(bundle({ "package.json": '{"dependencies":{"next":"16"}}', "app/settings/page.tsx": 'import Shared from "../../components/shared"; export default function Settings(){return <Shared/>}', "app/projects/page.tsx": 'import Shared from "../../components/shared"; export default function Projects(){return <Shared/>}', "components/shared.tsx": "export default function Shared(){return <div/>}" }));
  impact.provenance.sourceEvidence[0].path = "app/settings/page.tsx"; currentPlan = transformationPlanFixture(impact, plan.decisions);
  const mapped = discoveredAssociations(impact, currentPlan, currentPlan.decisions[0], routes);
  assert.deepEqual(mapped.filter(choice => !choice.routeEvidence!.requiresConfirmation).map(choice => choice.value), ["/settings"]);
  impact.provenance.sourceEvidence[0].path = "components/shared.tsx"; currentPlan = transformationPlanFixture(impact, plan.decisions);
  const ambiguous = await transformDocumentation({ impact, plan: currentPlan, routes }); const state = await retainDocumentationProposal(ambiguous);
  assert.equal(state.targets.length, 0); assert.equal(state.destinationCandidates.length, 2); assert.equal((await getPendingWorkspace({ repository: name })).count, 0);
  const choices = await destinationChoices(ambiguous.proposalId); assert.equal(choices.length, 1); assert.deepEqual(choices[0].options.map(option => option.label), ["Settings", "Projects"]);
  const target = choices[0].options.find(option => option.route === "/settings")!;
  const confirmation = { repository: name, proposalId: ambiguous.proposalId, expectedHash: state.proposalHash, targetId: target.id, confirmed: true };
  await assert.rejects(confirmDocumentationDestination({ ...confirmation, confirmed: false }));
  await assert.rejects(confirmDocumentationDestination({ ...confirmation, targetId: randomUUID() }));
  await assert.rejects(confirmDocumentationDestination({ ...confirmation, expectedHash: "0".repeat(64) }));
  const rootDelivery = (await getContextualDocumentation({ owner, repo: "product", route: "/" })).publication!;
  const rootDocument = await getDocumentationDraft(rootDelivery.documentId, repository); assert.equal(rootDocument.status, "found");
  if (rootDocument.status === "found") {
    const otherPending = reviewProposalFixture(rootDocument.document, false); await retainDocumentationProposal(otherPending);
    await assert.rejects(confirmDocumentationDestination(confirmation), /other pending batch/);
    const otherView = await getPendingWorkspace({ repository: name });
    assert.equal((await discardPendingWorkspace({ repository: name, expectedHash: otherView.hash, confirmed: true })).status, "discarded");
  }
  await confirmDocumentationDestination(confirmation);
  await confirmDocumentationDestination(confirmation); // Idempotent receipt, never a second association.
  await assert.rejects(confirmDocumentationDestination({ ...confirmation, targetId: choices[0].options.find(option => option.route === "/projects")!.id }));
  const confirmed = await getDocumentationReview(ambiguous.proposalId); assert.equal(confirmed.status, "found"); if (confirmed.status === "found") { assert.equal(confirmed.proposalHash, state.proposalHash); assert.equal(confirmed.targets.length, 1); assert.ok(confirmed.targets[0].confirmedAt); }
  pending = await getPendingWorkspace({ repository: name }); assert.equal(pending.count, 1);
  assert.equal((await publishPendingWorkspace({ repository: name, expectedHash: pending.hash })).status, "published");
  assert.ok((await getContextualDocumentation({ owner, repo: "product", route: "/settings" })).publication);
  await assert.rejects(confirmDocumentationDestination(confirmation), /changed|expired/);
  assert.equal((await getContextualDocumentation({ owner, repo: "product", route: "/projects" })).publication, null, "unselected routes never gain SDK delivery authority");
  const delivered = (await getContextualDocumentation({ owner, repo: "product", route: "/settings" })).publication!;
  const saved = await getDocumentationDraft(delivered.documentId, repository); assert.equal(saved.status, "found");
  if (saved.status === "found") {
    const update = reviewProposalFixture(saved.document, false); const replacement = await retainDocumentationProposal(update);
    assert.deepEqual(replacement.targets.map(target => target.route), ["/settings"], "unselected historical discovery hints cannot create new publication authority");
    const view = await getPendingWorkspace({ repository: name }); assert.equal((await publishPendingWorkspace({ repository: name, expectedHash: view.hash })).status, "published");
  }
  const noRoute = await transformDocumentation({ impact, plan: currentPlan, routes: [] }); await retainDocumentationProposal(noRoute);
  assert.equal((await getPendingWorkspace({ repository: name })).count, 0); assert.deepEqual(await destinationChoices(noRoute.proposalId), []);
  validateDocumentationProposal(reviewProposalFixture()); // Historical operator-only documents stay compatible.
});
