import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { reviewProposalFixture, independentReviewProposalFixture } from "./review-fixtures";
import { draftFixture } from "./draft-fixture";
import { getDatabase, closeDatabase } from "@/integrations/database/client";
import { documentationReviews, documentationDrafts, documentationPublications } from "@/integrations/database/schema";
import { documentationReviewTransaction } from "@/integrations/database/documentation-reviews";
import { retainDocumentationProposal, getDocumentationReview } from "@/features/documentation/review-proposal-operations";
import { applyDocumentationReview } from "@/features/documentation/apply-documentation-review";
import { materializeApprovedUnit } from "@/features/documentation/materialize-approved-changes";
import { saveDocumentationDraft, getDocumentationDraft } from "@/features/documentation/operations";
import { publishDocumentation, getContextualDocumentation } from "@/features/documentation/publication-operations";
import { documentationHash } from "@/features/documentation/document-identity";
import type { DocumentationDocument } from "@/features/documentation/document";
import { normalizeReviewSelection } from "@/features/documentation/documentation-review";
import type { ReviewSelection } from "@/features/documentation/documentation-review";

test("model-free retained approval/save/publication integration proof", async t => {
  const owner = `review-${randomUUID()}`, repository = `https://github.com/${owner}/product`;
  const oldAllow = process.env.DOCSYDE_ANALYSIS_REPOSITORIES; process.env.DOCSYDE_ANALYSIS_REPOSITORIES = `${owner}/product`;
  const credentials = new Map(["BASETEN_API_KEY", "META_API_KEY"].map(key => [key, process.env[key]]));
  for (const key of credentials.keys()) delete process.env[key];
  t.after(() => { for (const [key, value] of credentials) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const noInference = t.mock.method(globalThis, "fetch", () => { throw new Error("Review must never invoke inference"); });
  const proposalIds: string[] = [], docIds = new Set<string>();
  const baseline = () => { const doc = draftFixture(); doc.provenance.repository = repository; docIds.add(doc.id); return doc; };
  const fixture = (doc: DocumentationDocument = baseline(), extras = true) => { const p = reviewProposalFixture(doc, extras); proposalIds.push(p.proposalId); return p; };
  const select = (p: ReturnType<typeof fixture>): ReviewSelection => ({ proposalId: p.proposalId, expectedProposalHash: documentationHash(p), decisions: [{ decisionId: "decision-1", choice: "approve" }, ...(p.results.length > 1 ? [{ decisionId: "decision-2", choice: "reject" as const }] : [])], publications: [] });
  const apply = async (selection: ReviewSelection, signal?: AbortSignal) => {
    const result = await applyDocumentationReview(selection, { signal });
    result.review?.saves.forEach(s => { if (s.documentId) docIds.add(s.documentId); }); return result;
  };
  t.after(async () => {
    try {
      await getDatabase().delete(documentationReviews).where(inArray(documentationReviews.id, proposalIds));
      await getDatabase().delete(documentationPublications).where(eq(documentationPublications.repository, repository));
      await getDatabase().delete(documentationDrafts).where(inArray(documentationDrafts.id, [...docIds]));
    } finally { await closeDatabase(); if (oldAllow === undefined) delete process.env.DOCSYDE_ANALYSIS_REPOSITORIES; else process.env.DOCSYDE_ANALYSIS_REPOSITORIES = oldAllow; }
  });
  await t.test("retain → show → subset → v2 save → replace → contextual read; replay and frozen selection", async () => {
    const doc = baseline(), p = fixture(doc); await saveDocumentationDraft(doc);
    const route = { owner, repo: "product", route: `/replace-${randomUUID()}` };
    const first = await publishDocumentation({ ...route, draftId: doc.id });
    const retained = await retainDocumentationProposal(p), loaded = await getDocumentationReview(p.proposalId);
    assert.equal(loaded.status, "found");
    const replacement = retained.targets.find(t => t.observedId === first.publication!.id)!;
    const selection = select(p); selection.publications = [{ targetId: replacement.id, intent: "replace", observedPublicationId: replacement.observedId! }];
    const result = await apply(selection); assert.equal(result.status, "complete"); assert.equal(result.review!.saves.length, 1);
    const saved = await getDocumentationDraft(result.review!.saves[0].documentId!); assert.equal(saved.status, "found");
    if (saved.status !== "found") throw new Error("Missing saved document");
    assert.equal(saved.document.schemaVersion, 2); assert.equal(saved.document.sections.length, doc.sections.length);
    assert.deepEqual(saved.document.sections[1], doc.sections[1]); assert.notEqual(saved.document.id, p.candidates[0].document.id);
    if (saved.document.schemaVersion === 2) assert.deepEqual(saved.document.provenance.revision.decisionIds, ["decision-1"]);
    assert.equal((await getContextualDocumentation(route)).publication!.documentId, saved.document.id);
    const original = await getDocumentationDraft(doc.id); if (original.status === "found") assert.deepEqual(original.document, doc); else assert.fail("Baseline missing");
    const replay = await apply({ ...selection, decisions: [...selection.decisions].reverse() }); assert.deepEqual(replay.review, result.review);
    assert.equal((await apply({ ...selection, decisions: [{ decisionId: "decision-1", choice: "reject" }] })).status, "selection-conflict");
    const next = fixture(saved.document, false); await retainDocumentationProposal(next);
    const subsequent = await apply(select(next)); assert.equal(subsequent.status, "complete");
  });
  await t.test("save-only and publication conflict retains successful immutable save", async () => {
    const doc = baseline(), p = fixture(doc); await saveDocumentationDraft(doc);
    const route = { owner, repo: "product", route: `/conflict-${randomUUID()}` };
    const original = await publishDocumentation({ ...route, draftId: doc.id });
    const retained = await retainDocumentationProposal(p), descriptor = retained.targets.find(t => t.route === route.route)!;
    const moved = await publishDocumentation({ ...route, draftId: doc.id, observedId: original.publication!.id });
    // Same-document publish is idempotent, so force a new observed identity through SQL as a competing operator write.
    await getDatabase().update(documentationPublications).set({ id: randomUUID() }).where(eq(documentationPublications.id, moved.publication!.id));
    const choice = select(p); choice.publications = [{ targetId: descriptor.id, intent: "replace", observedPublicationId: descriptor.observedId! }];
    const result = await apply(choice); assert.equal(result.status, "partial"); assert.equal(result.review!.saves[0].status, "saved"); assert.equal(result.review!.publications[0].status, "conflict");
    assert.equal((await getContextualDocumentation(route)).publication!.documentId, doc.id);
    const only = fixture(); await saveDocumentationDraft(only.targets[0].document); await retainDocumentationProposal(only);
    const saved = await apply(select(only)); assert.equal(saved.status, "complete"); assert.equal(saved.review!.publications.length, 0);
  });
  await t.test("expected absence publishes only approved contextual content; occupied route conflicts", async () => {
    const doc = baseline(); doc.context[0].value = `/new-${randomUUID()}`;
    const p = fixture(doc); await saveDocumentationDraft(doc); const retained = await retainDocumentationProposal(p);
    const descriptor = retained.targets.find(t => t.route === doc.context[0].value)!;
    const choice = select(p); choice.publications = [{ targetId: descriptor.id, intent: "publish" }];
    const result = await apply(choice); assert.equal(result.review!.publications[0].status, "published");
    const second = baseline(); second.context[0].value = `/occupied-${randomUUID()}`; await saveDocumentationDraft(second);
    const other = fixture(second); const state = await retainDocumentationProposal(other); const target = state.targets.find(t => t.route === second.context[0].value)!;
    await publishDocumentation({ owner, repo: "product", route: target.route, draftId: second.id });
    const selections = select(other); selections.publications = [{ targetId: target.id, intent: "publish" }];
    const conflict = await apply(selections); assert.equal(conflict.review!.saves[0].status, "saved"); assert.equal(conflict.review!.publications[0].reason, "publication-occupied");
  });
  await t.test("invalid choices, tampering, expiry and repository isolation have no save effects", async () => {
    const p = fixture(); await saveDocumentationDraft(p.targets[0].document); await retainDocumentationProposal(p);
    assert.equal((await apply({ ...select(p), expectedProposalHash: "0".repeat(64) })).status, "hash-mismatch");
    for (const decisions of [[{ decisionId: "decision-8", choice: "approve" }], [{ decisionId: "decision-3", choice: "approve" }], [{ decisionId: "decision-1", choice: "acknowledge" }], [{ decisionId: "decision-1", choice: "approve" }, { decisionId: "decision-1", choice: "reject" }]]) assert.equal((await applyDocumentationReview({ ...select(p), decisions })).status, "invalid-selection");
    assert.equal((await getDocumentationReview(p.proposalId)).status, "found");
    const tampered = structuredClone(p); tampered.results[0].change = null; await assert.rejects(retainDocumentationProposal(tampered));
    const expired = fixture(); await retainDocumentationProposal(expired, { lifetimeMs: 1 });
    await getDatabase().update(documentationReviews).set({ registeredAt: new Date(Date.now() - 2000), expiresAt: new Date(Date.now() - 1000) }).where(eq(documentationReviews.id, expired.proposalId));
    assert.equal((await apply(select(expired))).status, "expired");
    process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "other/repo";
    assert.equal((await apply(select(p))).status, "repository-mismatch"); await assert.rejects(getDocumentationReview(p.proposalId));
    process.env.DOCSYDE_ANALYSIS_REPOSITORIES = `${owner}/product`;
    const state = await getDocumentationReview(p.proposalId); if (state.status === "found") assert.equal(state.review, null);
  });
  await t.test("no-change/unresolved acknowledgment makes no document/publication writes", async () => {
    const p = fixture(); await retainDocumentationProposal(p);
    const result = await apply({ ...select(p), decisions: [{ decisionId: "decision-3", choice: "acknowledge" }, { decisionId: "decision-4", choice: "reject" }] });
    assert.equal(result.status, "complete"); assert.deepEqual(result.review!.saves, []); assert.deepEqual(result.review!.publications, []);
    assert.equal(result.decisions!.find(d => d.decisionId === "decision-4")!.action, "unresolved");
  });
  await t.test("missing/mutated baselines block without regeneration", async () => {
    const missing = fixture(); await retainDocumentationProposal(missing);
    assert.equal((await apply(select(missing))).review!.saves[0].baseline, "missing");
    const stale = fixture(); await saveDocumentationDraft(stale.targets[0].document); await retainDocumentationProposal(stale);
    await getDatabase().update(documentationDrafts).set({ document: { ...stale.targets[0].document, title: "Out-of-band corruption" } }).where(eq(documentationDrafts.id, stale.targets[0].document.id));
    const result = await apply(select(stale)); assert.equal(result.review!.saves[0].baseline, "mismatched"); assert.equal(result.review!.saves[0].status, "blocked");
  });
  await t.test("cancellation and identical concurrent replay, including after expiry", async () => {
    const p = fixture(); await saveDocumentationDraft(p.targets[0].document); await retainDocumentationProposal(p);
    const controller = new AbortController(); controller.abort(); assert.equal((await apply(select(p), controller.signal)).status, "cancelled");
    const [a, b] = await Promise.all([apply(select(p)), apply(select(p))]); assert.deepEqual(a.review, b.review);
    await getDatabase().update(documentationReviews).set({ registeredAt: new Date(Date.now() - 2000), expiresAt: new Date(Date.now() - 1000) }).where(eq(documentationReviews.id, p.proposalId));
    assert.deepEqual((await apply(select(p))).review, a.review);
  });
  await t.test("equal/conflicting immutable saves and transaction rollback keeps effect/receipt coupled", async () => {
    const p = fixture(); await saveDocumentationDraft(p.targets[0].document); await retainDocumentationProposal(p);
    const result = await apply(select(p)), review = result.review!;
    const candidate = materializeApprovedUnit(p, review.operationId, [p.results[0]]);
    const savedAgain = await saveDocumentationDraft(candidate); assert.equal(savedAgain.status, "saved");
    assert.equal((await saveDocumentationDraft({ ...candidate, title: "Conflicting body" })).status, "conflict");
    const rollbackId = randomUUID(); docIds.add(rollbackId);
    await assert.rejects(documentationReviewTransaction(p.proposalId, async scope => {
      await scope.save(rollbackId, { ...candidate, id: rollbackId });
      await scope.receipt({ ...review, saves: [] });
      throw new Error("Injected receipt transaction failure");
    }));
    assert.equal((await getDocumentationDraft(rollbackId)).status, "missing");
    const after = await getDocumentationReview(p.proposalId); if (after.status === "found") assert.deepEqual(after.review, review);
    const route = `/rollback-${randomUUID()}`;
    await assert.rejects(documentationReviewTransaction(p.proposalId, async scope => {
      await scope.insertPublication(repository, route, candidate.id);
      await scope.receipt({ ...review, publications: [] }); throw new Error("Injected publication receipt failure");
    }));
    assert.equal((await getContextualDocumentation({ owner, repo: "product", route })).publication, null);
  });
  await t.test("actual receipt failures roll back saves/publications and identical resume completes", async () => {
    const p = fixture(); await saveDocumentationDraft(p.targets[0].document);
    const route = { owner, repo: "product", route: `/receipt-${randomUUID()}` };
    await publishDocumentation({ ...route, draftId: p.targets[0].document.id });
    const retained = await retainDocumentationProposal(p), target = retained.targets.find(t => t.route === route.route)!;
    const choice = select(p); choice.publications = [{ targetId: target.id, intent: "replace", observedPublicationId: target.observedId! }];
    const suffix = randomUUID().replaceAll("-", ""), fn = sql.identifier(`review_fail_${suffix}`), trigger = sql.identifier(`review_fail_${suffix}`);
    const createFault = async (field: "saves" | "publications") => {
      // Test-only, scoped to one isolated retained row. No product failure hook.
      await getDatabase().execute(sql`CREATE FUNCTION docsyde.${fn}() RETURNS trigger LANGUAGE plpgsql AS ${sql.raw(`'BEGIN IF NEW.id = ''${p.proposalId}''::uuid AND jsonb_array_length(NEW.review->''${field}'') > 0 THEN RAISE EXCEPTION ''injected receipt failure''; END IF; RETURN NEW; END'`)}`);
      await getDatabase().execute(sql`CREATE TRIGGER ${trigger} BEFORE UPDATE ON docsyde.documentation_proposal_reviews FOR EACH ROW EXECUTE FUNCTION docsyde.${fn}()`);
    };
    const dropFault = async () => { await getDatabase().execute(sql`DROP TRIGGER IF EXISTS ${trigger} ON docsyde.documentation_proposal_reviews`); await getDatabase().execute(sql`DROP FUNCTION IF EXISTS docsyde.${fn}()`); };
    try {
      await createFault("saves");
      const failed = await apply(choice); assert.equal(failed.status, "unfinished"); assert.deepEqual(failed.review!.saves, []);
      const candidate = materializeApprovedUnit(p, failed.review!.operationId, [p.results[0]]); docIds.add(candidate.id);
      assert.equal((await getDocumentationDraft(candidate.id)).status, "missing");
      await dropFault(); await createFault("publications");
      const saved = await apply(choice); assert.equal(saved.status, "unfinished"); assert.equal(saved.review!.saves[0].status, "saved"); assert.deepEqual(saved.review!.publications, []);
      assert.equal((await getContextualDocumentation(route)).publication!.id, target.observedId);
      await dropFault();
      const complete = await apply(choice); assert.equal(complete.status, "complete"); assert.equal(complete.review!.operationId, failed.review!.operationId);
      assert.equal(complete.review!.saves[0].documentId, candidate.id);
    } finally { await dropFault(); }
  });
  await t.test("independent document succeeds when sibling baseline is missing", async () => {
    const missing = baseline(), valid = baseline(), p = independentReviewProposalFixture([missing, valid]);
    proposalIds.push(p.proposalId); await saveDocumentationDraft(valid); await retainDocumentationProposal(p);
    const selection = { ...select(p), decisions: p.results.map(r => ({ decisionId: r.decisionId, choice: "approve" as const })) };
    const result = await apply(selection); assert.equal(result.status, "partial");
    assert.equal(result.review!.saves[0].status, "blocked"); assert.equal(result.review!.saves[1].status, "saved");
  });
  await t.test("unsupported content cannot be approved by changing client flags", async () => {
    const p = fixture(); p.status = "partial"; p.candidates = [];
    for (const r of p.results.slice(0, 2)) { r.materialization = "blocked"; r.candidateId = null; r.saveCompatible = false; }
    p.results[0].support = "unsupported"; p.results[0].reviewReady = false; p.results[0].issues.push("wording-not-supported");
    p.results[1].issues.push("another-target-decision-incomplete"); p.supportChecks[0].verdict = "unsupported";
    await retainDocumentationProposal(p);
    assert.equal((await apply(select(p))).status, "invalid-selection");
    assert.equal((await applyDocumentationReview({ ...select(p), reviewReady: true })).status, "invalid-selection");
    const retained = await getDocumentationReview(p.proposalId); if (retained.status === "found") assert.equal(retained.review, null);
  });
  await t.test("preexisting equal candidate is idempotent; same identity with different body conflicts", async () => {
    for (const conflict of [false, true]) {
      const p = fixture(); await saveDocumentationDraft(p.targets[0].document); await retainDocumentationProposal(p);
      const selection = normalizeReviewSelection(select(p)), operationId = randomUUID();
      await documentationReviewTransaction(p.proposalId, async scope => scope.receipt({ operationId, selection, selectionHash: documentationHash(selection), acceptedAt: new Date().toISOString(), saves: [], publications: [] }));
      const candidate = materializeApprovedUnit(p, operationId, [p.results[0]]); docIds.add(candidate.id);
      await saveDocumentationDraft(conflict ? { ...candidate, title: "Different existing content" } : candidate);
      const result = await apply(selection);
      assert.equal(result.review!.saves[0].status, conflict ? "conflict" : "saved");
      assert.equal(result.review!.saves[0].equalSave, !conflict);
    }
    assert.equal((await apply({ ...select(fixture()), proposalId: randomUUID() })).status, "missing");
  });
  assert.equal(noInference.mock.callCount(), 0);
  const count = await getDatabase().execute(sql`select count(*) from docsyde.documentation_proposal_reviews where repository = ${repository}`);
  assert.ok(Number(count.rows[0].count) > 0);
});
