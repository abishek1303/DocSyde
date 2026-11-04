import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { compositionInput, applyComposition } from "./compose-documentation";
import { transformationSource, authorizeTransformation } from "./transformation-input";
import { decisionResultSchema } from "./documentation-change-proposal";
import { transformationImpactFixture, transformationPlanFixture, transformationDecisionFixture, transformationEntryFixture } from "../../../../infra/local/documentation/transformation-fixtures";

const original = "Issues are grouped by status. Each group is presented as a collapsible section. Expand or collapse a group to focus on the relevant status.";
function fixture() {
  const impact = transformationImpactFixture(), decision = transformationDecisionFixture(null, null, "add"), plan = transformationPlanFixture(impact, [decision]);
  const result = decisionResultSchema.parse({ decisionId: "decision-1", decision, generation: "pending", support: "not-required", reviewReady: false, saveCompatible: false, approval: "not-requested", materialization: "pending", issues: [], limitations: [], change: null, model: null, candidateId: null });
  const auth = authorizeTransformation(impact, plan, result, undefined, transformationSource(impact, randomUUID(), []), [{ id: "home", kind: "route", value: "/", origin: "operator" }]);
  const entry = transformationEntryFixture(auth, []); assert.ok(entry.change.kind === "add-document");
  entry.change.associations = ["home"]; entry.change.sections[0].content[0].markdown = original;
  return { auth, change: entry.change };
}

test("required-detail checklist retains the precise expand/collapse behavior and instruction", () => {
  const { auth, change } = fixture(), input = JSON.parse(compositionInput(change, auth));
  assert.deepEqual(input.sections[0].content[0].requiredDetails, ["Issues are grouped by status.", "Each group is presented as a collapsible section.", "Expand or collapse a group to focus on the relevant status."]);
  assert.equal(input.sections[0].content[0].markdown, original);
  assert.deepEqual(input.sections[0].content[0].facts[0].qualifications, auth.facts[0].qualifications);
});

test("product-facing prose preserves server-owned facts, routes and section correspondence", () => {
  const { auth, change } = fixture();
  const after = applyComposition(change, { sections: [{ sectionRef: 0, title: "Browse issues by status", content: [{ blockRef: 0, parts: [
    { kind: "paragraph", text: "Issues are grouped by status. Expand or collapse a group to focus on the issues you need." },
  ] }] }] }, auth);
  assert.ok(after.kind === "add-document");
  assert.deepEqual(after.associations, change.associations);
  assert.deepEqual(after.sections[0].content[0].factRefs, change.sections[0].content[0].factRefs);
  assert.deepEqual(after.sections[0].content[0].claimRefs, change.sections[0].content[0].claimRefs);
  assert.equal(after.sections[0].title, "Browse issues by status");
  assert.match(after.sections[0].content[0].markdown, /Expand or collapse/);
  assert.deepEqual(change.sections[0].content[0].markdown, original, "editor does not mutate the original used for preservation checks");
});
