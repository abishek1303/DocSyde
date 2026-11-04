import assert from "node:assert/strict";
import { test } from "node:test";
import { draftFixture } from "../../../../infra/local/documentation/draft-fixture";
import { v2CandidateFixture } from "../../../../infra/local/documentation/v2-fixture";
import { documentationHash } from "./document-identity";
import { projectSectionContexts } from "./section-context";

function findingDocument() {
  const document = v2CandidateFixture().document;
  document.context.push({ id: "retained-finding", kind: "feature", value: "Request field", origin: "finding", findingRef: document.provenance.findings[0].id });
  document.associations.push("retained-finding");
  return document;
}

function discoveryDocument(runtime = false) {
  const document = findingDocument();
  document.context.find(a => a.id === "route-form")!.origin = "discovery";
  document.context.find(a => a.id === "route-form")!.routeEvidence = {
    label: "Request desk", method: runtime ? "runtime-navigation" : "file-page",
    commitId: document.provenance.contexts[0].head,
    sources: [{ path: "src/app/page.tsx", line: 1, excerpt: "export default function Page() {}" }],
    requiresConfirmation: runtime,
    ...(runtime ? { observation: { captureId: document.id, artifactKey: document.sections[0].id,
      capturedAt: "2026-11-04T00:00:00.000Z", screenshotSha256: "a".repeat(64), runtimeRevisionVerified: false as const } } : {}),
  };
  return document;
}

test("discovery projections preserve pinned source and runtime route evidence without finding references", () => {
  for (const runtime of [false, true]) {
    const document = discoveryDocument(runtime), before = JSON.stringify(document);
    const contexts = projectSectionContexts(JSON.parse(before));
    for (const section of contexts) {
      const route = section.associations.find(a => a.id === "route-form")!;
      assert.deepEqual(route.provenance, { origin: "discovery", routeEvidence: document.context[0].routeEvidence });
      assert.equal(route.scope, "document");
      assert.equal(section.documentSha256, documentationHash(document));
    }
    assert.equal(JSON.stringify(document), before);
    assert.deepEqual(projectSectionContexts(document), contexts);
  }
});

test("operator and finding projections retain exact historical v1 and v2 provenance", () => {
  for (const document of [draftFixture(), findingDocument()]) {
    const contexts = projectSectionContexts(document);
    assert.deepEqual(contexts[0].associations.find(a => a.id === "route-form")!.provenance,
      { origin: "explicit", associationId: "route-form" });
    const association = document.context.find(a => a.origin === "finding")!;
    const finding = document.provenance.findings.find(f => f.id === association.findingRef)!;
    assert.deepEqual(contexts[0].associations.find(a => a.id === association.id)!.provenance,
      { origin: "inferred", findingId: finding.id, context: document.schemaVersion === 1
        ? { version: 1, analysisId: document.provenance.analysisId }
        : { version: 2, evidenceContextId: document.provenance.findings.find(f => f.id === association.findingRef)!.contextId } });
  }
});

test("invalid origins, missing finding references and invalid discovery proof still fail canonical validation", () => {
  const mutations: ((d: ReturnType<typeof discoveryDocument>) => void)[] = [
    d => { delete d.context[0].routeEvidence; },
    d => { d.context[0].routeEvidence!.commitId = "f".repeat(40); },
    d => { d.context[0].routeEvidence!.sources = []; },
    d => { d.context[0].kind = "feature"; },
    d => { d.context[0].findingRef = d.provenance.findings[0].id; },
    d => { d.context[0].origin = "operator"; },
    d => { delete d.context.find(a => a.origin === "finding")!.findingRef; },
    d => { d.context.find(a => a.origin === "finding")!.findingRef = "unavailable"; },
  ];
  for (const mutate of mutations) {
    const document = discoveryDocument(); mutate(document);
    assert.throws(() => projectSectionContexts(document));
  }
  const legacy = draftFixture(); legacy.context[0].origin = "discovery";
  legacy.context[0].routeEvidence = discoveryDocument().context[0].routeEvidence;
  assert.throws(() => projectSectionContexts(legacy), "Discovery remains v2-only");
});
