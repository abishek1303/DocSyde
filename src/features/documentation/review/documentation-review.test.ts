import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { reviewProposalFixture } from "../../../../infra/local/documentation/review-fixtures";
import { validateDocumentationProposal } from "../transformation/validate-documentation-proposal";
import { materializeApprovedUnit, intrinsicReviewReady } from "./materialize-approved-changes";
import { documentationHash } from "../documents/document-identity";
import { normalizeReviewSelection } from "./documentation-review";

test("trusted proposal graph validates and selected patch retains unrelated content", () => {
  const p = validateDocumentationProposal(reviewProposalFixture()), operation = randomUUID();
  const a = materializeApprovedUnit(p, operation, [p.results[0]]);
  assert.equal(a.sections.length, p.targets[0].document.sections.length);
  assert.deepEqual(a.sections[1], p.targets[0].document.sections[1]);
  assert.deepEqual(a.provenance.revision.decisionIds, ["decision-1"]);
  assert.equal(a.provenance.contexts.length, 2);
  assert.deepEqual(a, materializeApprovedUnit(p, operation, [p.results[0]]));
  const b = materializeApprovedUnit(p, operation, p.results.slice(0, 2));
  assert.notEqual(a.id, b.id); assert.notEqual(documentationHash(a), documentationHash(b));
  const subsequent = validateDocumentationProposal(reviewProposalFixture(a, false));
  const c = materializeApprovedUnit(subsequent, randomUUID(), [subsequent.results[0]]);
  assert.equal(c.provenance.revision.basedOn?.documentId, a.id);
  assert.equal(c.schemaVersion, 2);
});
for (const [name, mutate] of [
  ["impact hash", (p) => { p.impactSha256 = "0".repeat(64); }],
  ["plan hash", (p) => { p.planSha256 = "0".repeat(64); }],
  ["baseline hash", (p) => { p.targets[0].identity.sha256 = "0".repeat(64); }],
  ["decision ordering", (p) => { p.results.reverse(); }],
  ["catalog", (p) => { p.authorizations[0].facts[0].value = "fabricated"; }],
  ["support records", (p) => { p.supportChecks = []; }],
  ["candidate", (p) => { p.candidates[0].document.title = "fabricated"; }],
  ["ownership", (p) => { p.results[0].decision.sectionId = randomUUID(); }],
  ["repository", (p) => { p.targets[0].document.provenance.repository = "https://github.com/other/repo"; }],
] as [string, (p: ReturnType<typeof reviewProposalFixture>) => void][]) test(`admission rejects inconsistent ${name}`, () => {
  const p = reviewProposalFixture(); mutate(p); assert.throws(() => validateDocumentationProposal(p));
});
test("subset may recover aggregate blockage but not missing grounding or placement", () => {
  const p = reviewProposalFixture(); p.candidates = []; p.status = "partial";
  for (const r of p.results.slice(0, 2)) { r.candidateId = null; r.materialization = "blocked"; r.saveCompatible = false; r.issues.push("another-target-decision-incomplete"); }
  validateDocumentationProposal(p);
  assert.ok(intrinsicReviewReady(p, p.results[0]));
  assert.ok(materializeApprovedUnit(p, randomUUID(), [p.results[0]]));
  p.results[0].support = "uncertain"; assert.equal(intrinsicReviewReady(p, p.results[0]), false);
  if (p.results[1].change?.kind === "add-section") p.results[1].change.placement = { position: "undetermined", sectionId: null, reason: "Unknown" };
  assert.equal(intrinsicReviewReady(p, p.results[1]), false);
});
test("selection contract forbids content/targets and duplicate identities; order normalizes", () => {
  const input = { proposalId: randomUUID(), expectedProposalHash: "a".repeat(64), decisions: [{ decisionId: "decision-2", choice: "reject" }, { decisionId: "decision-1", choice: "approve" }], publications: [] };
  assert.deepEqual(normalizeReviewSelection(input), normalizeReviewSelection({ ...input, decisions: [...input.decisions].reverse() }));
  assert.throws(() => normalizeReviewSelection({ ...input, document: {} }));
  assert.throws(() => normalizeReviewSelection({ ...input, decisions: [input.decisions[0], input.decisions[0]] }));
});


test("review dependency graph loads no inference capabilities", () => {
  const require = createRequire(import.meta.url);
  require("./apply-documentation-review");
  const loaded = Object.keys(require.cache);
  assert.equal(loaded.some(path => /integrations\/ai\/(?:generate-structured|analyze-screenshot|meta\/invoke-vision|baseten\/invoke)/.test(path)), false);
});

test("warning review requires explicit acknowledgment and keeps authorization gates", async () => {
  const { validateReviewSelection } = await import("./apply-documentation-review");
  const { requireWarningAcknowledgment } = await import("./documentation-review");
  const p = reviewProposalFixture(); const result = p.results[0];
  const checks = p.supportChecks.filter(check => check.decisionId === result.decisionId);
  for (const check of checks) { check.verdict = "uncertain"; check.category = "omission"; check.factRefs = p.authorizations[0].facts.map(fact => fact.id); }
  result.support = "uncertain"; result.reviewOutcome = "warnings";
  assert.equal(intrinsicReviewReady(p, result), true);
  const selection = normalizeReviewSelection({ proposalId: p.proposalId, expectedProposalHash: documentationHash(p), decisions: [{ decisionId: result.decisionId, choice: "approve" }], publications: [] });
  assert.throws(() => validateReviewSelection(p, [], selection), /acknowledgment/);
  selection.decisions[0].acknowledgeWarnings = true;
  assert.doesNotThrow(() => validateReviewSelection(p, [], selection));
  assert.throws(() => validateReviewSelection(p, [], { ...selection, publications: [{ targetId: randomUUID(), intent: "publish" }] }), /Unauthorized publication target/);
  assert.throws(() => requireWarningAcknowledgment(checks, false), /acknowledgment/);
  assert.doesNotThrow(() => requireWarningAcknowledgment(checks, true));
  checks[0].category = "unsupported-feature"; result.reviewOutcome = "blocked";
  assert.throws(() => validateReviewSelection(p, [], selection), /cannot be approved/);
  assert.throws(() => normalizeReviewSelection({ ...selection, decisions: [{ ...selection.decisions[0], acknowledgeWarnings: false }] }));
});
