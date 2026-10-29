import { randomUUID } from "node:crypto";
import type { DocumentationDocument } from "@/features/documentation/document";

// Test/verification data only; never seeded by migrations or application routes.
export function draftFixture(): DocumentationDocument {
  const qualifications = { support: "inferred" as const, confidence: "low" as const, confidenceReason: "Fixture has no runtime evidence", assumptions: ["Caller uses the schema"], uncertainties: ["Reachability unverified"] };
  return {
    id: randomUUID(), schemaVersion: 1, status: "draft", title: "Persistence verification draft",
    associations: ["route-form"],
    context: [{ id: "route-form", kind: "route", value: "/fixture", origin: "operator" }, { id: "surface-form", kind: "ui-surface", value: "Fixture form", origin: "finding", findingRef: "finding-1" }],
    sections: [
      { id: randomUUID(), title: "Field requirement", kind: "requirements", associations: ["surface-form"], findingRefs: ["finding-1"], qualifications: [{ findingRef: "finding-1", ...structuredClone(qualifications) }], content: [{ markdown: "The fixture field **may be required**.", factRefs: ["fact-after"] }, { markdown: "- Required in this fixture", factRefs: ["fact-after"] }] },
      { id: randomUUID(), title: "Scope", kind: "limitations", associations: [], findingRefs: ["finding-1"], qualifications: [{ findingRef: "finding-1", ...structuredClone(qualifications) }], content: [{ markdown: "The requirement needs review against the caller.", factRefs: ["fact-after"] }] },
    ],
    provenance: {
      analysisId: randomUUID(), repository: "https://github.com/abishek1303/DocSyde", base: "a".repeat(40), head: "b".repeat(40), assessment: "product-change", limited: true, limitations: ["Verification fixture; not a real analysis"],
      facts: [{ id: "fact-after", findingRef: "finding-1", field: "after", value: "Required", qualifications: structuredClone(qualifications) }],
      findings: [{ id: "finding-1", kind: "field-requirement-changed", description: "The fixture field became required", before: "Optional", after: "Required", qualifications: structuredClone(qualifications), citations: [{ evidenceId: "patch-1", startLine: 1, endLine: 1, excerpt: "+required" }] }],
      evidence: [{ id: "patch-1", path: "fixture.ts", side: "patch", commitId: null, contentId: null }],
    },
    generation: { model: "verification-fixture-no-model-call", createdAt: new Date().toISOString() },
  };
}
