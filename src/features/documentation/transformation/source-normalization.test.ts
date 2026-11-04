import { test } from "node:test";
import assert from "node:assert/strict";
import { transformationImpactFixture, transformationPlanFixture, transformationDecisionFixture } from "../../../../infra/local/documentation/transformation-fixtures";
import { validateSourceNormalization } from "./source-normalization";
import type { TransformationChange } from "./documentation-change-proposal";
import { rejectionDiagnostic } from "@/integrations/ai/invocation-debug";

const payload = `const handleSubmit = async () => {
  if (!title.trim()) return;
  await addIssue({ title: title.trim(), status, priority,
    project_id: projectId ? parseInt(projectId, 10) : null });
};`;
function input(markdown: string) {
  const impact = transformationImpactFixture();
  // Reproduce polluted summaries: only the cited source is normalization authority.
  impact.provenance.sourceReferences[0].finding.description = "Title, Status and Priority are trimmed.";
  impact.claims[0].description = "Title, Status and Priority are trimmed.";
  impact.provenance.sourceReferences[0].finding.citations[0].excerpt = payload;
  const plan = transformationPlanFixture(impact, [transformationDecisionFixture(null, null, "add")]);
  const change: TransformationChange = { kind: "add-document", title: "Create an issue", associations: [], sections: [{ title: "Submit", kind: "workflow", associations: [],
    content: [{ markdown, claimRefs: ["claim-1"], factRefs: ["fact-1"] }] }] };
  return { impact, plan, change };
}
for (const text of ["On submit, Title, Status, and Priority are trimmed.", "Trim Title, Status and Priority before submitting.", "Whitespace is trimmed from Status."]) test(`reject source-contradicting normalization: ${text}`, () => {
  const { change, impact, plan } = input(text);
  assert.throws(() => validateSourceNormalization(change, impact, plan, ["claim-1"]), error => {
    assert.equal(rejectionDiagnostic(error, "grounding-rejection").code, "source-normalization-mismatch"); return true;
  });
});
for (const text of ["Title is trimmed. Status and Priority are submitted unchanged.", "Trim the Title; keep Status and Priority unchanged.", "Status and Priority are not trimmed. Title is trimmed.", "Do not trim Status or Priority."]) test(`preserve supported normalization: ${text}`, () => {
  const { change, impact, plan } = input(text);
  assert.doesNotThrow(() => validateSourceNormalization(change, impact, plan, ["claim-1"]));
});
test("only the block's cited claim can supply normalization proof", () => {
  const { change, impact, plan } = input("Status is trimmed.");
  impact.provenance.sourceReferences[0].finding.citations[0].excerpt = payload.replace("status,", "status: status.trim(),");
  assert.doesNotThrow(() => validateSourceNormalization(change, impact, plan, ["claim-1"]));
});
