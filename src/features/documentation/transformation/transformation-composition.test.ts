import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { compositionOutputSchema } from "@/integrations/ai/composition-output";
import { compositionInput, applyComposition } from "./compose-documentation";
import { authoredSections } from "./transformation-validation";
import { transformationImpactFixture, transformationPlanFixture, transformationDecisionFixture, transformationEntryFixture } from "../../../../infra/local/documentation/transformation-fixtures";
import { authorizeTransformation, transformationSource } from "./transformation-input";
import type { DecisionResult } from "./documentation-change-proposal";

function fixture() {
  const impact = transformationImpactFixture(), decision = transformationDecisionFixture(null, null, "add"), plan = transformationPlanFixture(impact, [decision]);
  const result: DecisionResult = { decisionId: "decision-1", decision, generation: "pending", support: "not-required", reviewReady: false, saveCompatible: false, approval: "not-requested", materialization: "pending", issues: [], limitations: [], change: null, model: null, candidateId: null };
  const auth = authorizeTransformation(impact, plan, result, undefined, transformationSource(impact, "fixture", []), []);
  return { auth, change: transformationEntryFixture(auth, []).change };
}
const output = { sections: [{ sectionRef: 0, title: "Request requirements", content: [{ blockRef: 0, parts: [{ kind: "steps" as const, items: ["Provide a request title."] }] }] }] };

test("composition maps rich presentation to canonical blocks while preserving evidence refs and scope", () => {
  const { auth, change } = fixture(), before = structuredClone(change);
  const composed = applyComposition(change, output, auth);
  const original = authoredSections(change)[0].content[0], block = authoredSections(composed)[0].content[0];
  assert.equal(block.markdown, "1. Provide a request title."); assert.deepEqual(block.factRefs, original.factRefs); assert.deepEqual(block.claimRefs, original.claimRefs);
  assert.deepEqual(change, before);
  const input = JSON.parse(compositionInput(change, auth, undefined, ["Request: work item"]));
  assert.deepEqual(input.terminology, ["Request: work item"]); assert.ok(Buffer.byteLength(JSON.stringify(input)) < 4096);
  assert.equal(input.sections[0].content[0].facts[0].value, auth.facts.find(f => original.factRefs.includes(f.id))!.value);
  assert.equal(JSON.stringify(input).includes("sourceEvidence"), false);
});

test("strict composition schema and canonical adapter reject expansion, unknown refs and unsafe markup", () => {
  const { auth, change } = fixture();
  assert.equal(compositionOutputSchema.safeParse({ ...output, extra: true }).success, false);
  assert.equal(compositionOutputSchema.safeParse({ sections: Array(5).fill(output.sections[0]) }).success, false);
  for (const malformed of [
    { sections: [{ ...output.sections[0], sectionRef: 1 }] },
    { sections: [output.sections[0], output.sections[0]] },
    { sections: [{ ...output.sections[0], content: [{ blockRef: 1, parts: output.sections[0].content[0].parts }] }] },
    { sections: [{ ...output.sections[0], content: [{ blockRef: 0, parts: [{ kind: "paragraph", text: "<script>unsafe</script>" }] }] }] },
    { sections: [{ ...output.sections[0], content: [{ blockRef: 0, parts: [{ kind: "paragraph", text: "x".repeat(500) }, { kind: "paragraph", text: "y".repeat(500) }] }] }] },
  ]) assert.throws(() => applyComposition(change, malformed as typeof output, auth));
  const native = z.toJSONSchema(compositionOutputSchema);
  assert.equal(native.additionalProperties, false); const sections = native.properties?.sections;
  assert.ok(sections && typeof sections === "object"); assert.equal(sections.maxItems, 4);
});
