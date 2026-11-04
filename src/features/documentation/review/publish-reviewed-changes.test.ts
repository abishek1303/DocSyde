import { reviewProposalFixture } from "../../../../infra/local/documentation/review-fixtures";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
const load = createRequire(join(process.cwd(), "package.json"));
function setup(t: TestContext) {
  const proposalId = randomUUID(), hash = "a".repeat(64), documentId = randomUUID(), observedId = randomUUID();
  const state = { proposal: reviewProposalFixture(), status: "found", proposalHash: hash, repository: "https://github.com/example/product",
    review: { selection: { decisions: [{ decisionId: "decision-1", choice: "approve", acknowledgeWarnings: undefined as true | undefined }] }, saves: [{ unitId: "document", status: "saved", decisionIds: ["decision-1"], documentId }] },
    targets: [{ unitId: "document", route: "/issues", observedId }] };
  let current: { id: string; draftId: string } | null = { id: observedId, draftId: randomUUID() }, conflict = false;
  const writes: unknown[] = [];
  const paths = ["./src/features/documentation/review/review-proposal-operations.ts", "./src/features/documentation/publication/publication-operations.ts"];
  const modules = paths.map(path => { load(path); return load.cache[load.resolve(path)]!; }), old = modules.map(module => module.exports);
  modules[0].exports = { ...old[0], getDocumentationReviewPresentation: async () => state };
  modules[1].exports = { ...old[1], getPublication: async () => current, publishDocumentation: async (input: unknown) => { writes.push(input); return { status: conflict ? "conflict" : "published" }; } };
  const operationPath = load.resolve("./src/features/documentation/review/publish-reviewed-changes.ts"), previous = load.cache[operationPath];
  delete load.cache[operationPath];
  const { publishReviewedChanges } = load(operationPath) as typeof import("./publish-reviewed-changes");
  t.after(() => { modules.forEach((module, index) => { module.exports = old[index]; }); if (previous) load.cache[operationPath] = previous; else delete load.cache[operationPath]; });
  t.mock.method(globalThis, "fetch", () => { throw new Error("Publication must not invoke AI"); });
  return { state, documentId, observedId, writes, input: { proposalId, expectedProposalHash: hash }, publishReviewedChanges,
    current(value: typeof current) { current = value; }, conflict() { conflict = true; } };
}
test("explicit post-approval publication uses saved server-owned target and original observation", async t => {
  const s = setup(t);
  assert.equal((await s.publishReviewedChanges(s.input)).status, "published");
  assert.deepEqual(s.writes, [{ owner: "example", repo: "product", route: "/issues", draftId: s.documentId, observedId: s.observedId }]);
  await assert.rejects(s.publishReviewedChanges({ ...s.input, draftId: randomUUID(), route: "/other" }));
});
test("incomplete saves, unapproved choices and mismatched authority cannot publish", async t => {
  const s = setup(t);
  assert.equal((await s.publishReviewedChanges({ ...s.input, expectedProposalHash: "b".repeat(64) })).status, "unavailable");
  s.state.review.saves[0].status = "blocked";
  assert.equal((await s.publishReviewedChanges(s.input)).status, "unavailable");
  s.state.review.saves[0].status = "saved"; s.state.review.selection.decisions[0].choice = "reject";
  assert.equal((await s.publishReviewedChanges(s.input)).status, "unavailable"); assert.equal(s.writes.length, 0);
});
test("concurrent publication and write conflicts never trigger overwrite or retry", async t => {
  const s = setup(t);
  s.current({ id: randomUUID(), draftId: randomUUID() });
  assert.equal((await s.publishReviewedChanges(s.input)).status, "conflict"); assert.equal(s.writes.length, 0);
  s.current({ id: s.observedId, draftId: randomUUID() }); s.conflict();
  assert.equal((await s.publishReviewedChanges(s.input)).status, "conflict"); assert.equal(s.writes.length, 1);
});
test("already live approved document is idempotent and creates no new archive entry", async t => {
  const s = setup(t); s.current({ id: randomUUID(), draftId: s.documentId });
  assert.equal((await s.publishReviewedChanges(s.input)).status, "published"); assert.equal(s.writes.length, 0);
});

test("one stale destination blocks the whole preflight before any publication", async t => {
  const s = setup(t);
  s.state.targets.push({ unitId: "document", route: "/another-page", observedId: randomUUID() });
  assert.equal((await s.publishReviewedChanges(s.input)).status, "conflict"); assert.equal(s.writes.length, 0);
});


test("warning content cannot publish without explicit saved acknowledgment", async t => {
  const s = setup(t);
  for (const check of s.state.proposal.supportChecks.filter(check => check.decisionId === "decision-1")) {
    check.verdict = "uncertain"; check.category = "ambiguity";
    check.factRefs = [s.state.proposal.authorizations[0].facts[0].id];
  }
  assert.equal((await s.publishReviewedChanges(s.input)).status, "unavailable");
  assert.equal(s.writes.length, 0);
  s.state.review.selection.decisions[0].acknowledgeWarnings = true;
  assert.equal((await s.publishReviewedChanges(s.input)).status, "published");
  assert.equal(s.writes.length, 1);
});
