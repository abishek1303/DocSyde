import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { transformationImpactFixture, transformationPlanFixture, transformationDecisionFixture } from "../../../../infra/local/documentation/transformation-fixtures";
import { authorizeTransformation, transformationSource } from "./transformation-input";
import { decisionResultSchema } from "./documentation-change-proposal";
import { supportRequest } from "./validate-transformation-grounding";
import { productChangeInstructions } from "@/features/sources/analysis/product-change-prompt";
import { transformationInstructions } from "./transformation-prompt";

const excerpt = 'const status = "todo"; const priority = "none"; if (!title.trim()) return;';
function fixture() {
  const impact = transformationImpactFixture(2);
  impact.provenance.sourceReferences[0].finding.description = "Title, Status, and Priority are required.";
  impact.provenance.sourceReferences[0].finding.citations[0].excerpt = excerpt;
  impact.provenance.sourceReferences[1].finding.citations[0].excerpt = "UNRELATED_GUIDE_SOURCE";
  const decision = transformationDecisionFixture(null, null, "add"), plan = transformationPlanFixture(impact, [decision]);
  const result = decisionResultSchema.parse({ decisionId: "decision-1", decision, generation: "pending", support: "not-required", reviewReady: false, saveCompatible: false, approval: "not-requested", materialization: "pending", issues: [], limitations: [], change: null, model: null, candidateId: null });
  const source = transformationSource(impact, randomUUID(), []);
  const auth = authorizeTransformation(impact, plan, result, undefined, source, []);
  const units = [{ id: "decision-1-unit-1", decisionId: auth.decisionId, text: "Title, Status, and Priority are required.", claimRefs: ["claim-1"], factRefs: [auth.facts[0].id], structural: false }];
  return { source, auth, units };
}

test("production grounding context includes scoped primary excerpts even when the summary overstates requirements", () => {
  const { source, auth, units } = fixture(); const before = JSON.stringify(source);
  const request = supportRequest(units, [auth], new Map(), source);
  assert.equal(request.feasible, true);
  assert.match(request.input, /Title, Status, and Priority are required/);
  assert.ok(request.input.includes(JSON.stringify(excerpt)), "verifier sees validation/default source, not just the misleading summary");
  assert.ok(request.input.includes(JSON.stringify(source.findings[0].citations[0].evidenceId)));
  assert.match(request.input, /form-0.ts/); assert.match(request.input, /"side":"patch"/);
  assert.doesNotMatch(request.input, /UNRELATED_GUIDE_SOURCE/);
  assert.equal(JSON.stringify(source), before);
  assert.match(request.instructions, /summaries, confidence labels and originalText are fallible/);
  assert.match(request.instructions, /Source excerpts can constrain or refute summaries but do not authorize new claims/);
});

test("missing primary evidence stays explicit; oversized evidence fails feasibility without truncation", () => {
  const { source, auth, units } = fixture();
  const missing = supportRequest(units, [auth], new Map());
  assert.match(missing.input, /"sourceExcerpts":\[\]/);
  assert.match(missing.instructions, /Missing\/truncated evidence is uncertain\/ambiguity/);
  source.findings[0].citations[0].excerpt = "x".repeat(40 * 1024);
  const oversized = supportRequest(units, [auth], new Map(), source);
  assert.equal(oversized.feasible, false);
  assert.ok(oversized.input.includes("x".repeat(40 * 1024)), "never silently remove evidence to admit inference");
});

test("prompt contracts distinguish field presence, defaults, requirements and unverified absolutes", () => {
  assert.match(productChangeInstructions, /field presence, submitted values, defaults and enforced requirements/);
  assert.match(transformationInstructions, /Distinguish required input, defaulted values and unknown validation/);
  const { auth, units } = fixture(); const { instructions } = supportRequest(units, [auth], new Map());
  assert.match(instructions, /priority defaults to none/);
  assert.match(instructions, /Owner is always required -> uncertain\/ambiguity/);
  assert.match(instructions, /Equivalent supported wording: Enter a title/);
  assert.match(instructions, /300 ms search delay/);
});
