import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { draftFixture } from "../../../../infra/local/documentation/draft-fixture";
import { transformationImpactFixture } from "../../../../infra/local/documentation/transformation-fixtures";
import { documentationHash, documentationId } from "./document-identity";
import { promoteDocumentProvenance } from "../transformation/assemble-documentation-change";
import { transformationSource } from "../transformation/transformation-input";
import { validateDocumentationDocument } from "./document-validation";
import { documentV2Schema, V2_MAX_CONTEXTS, V2_MAX_FACTS, V2_MAX_FINDINGS, V2_MAX_EVIDENCE, type DocumentationDocumentV2 } from "./document";
import { v2CandidateFixture } from "../../../../infra/local/documentation/v2-fixture";
import { DOCUMENTATION_DOCUMENT_MAX_BYTES } from "../drafts/draft-limits";


test("v1 promotion and mixed-comparison revision preserve historical sections verbatim without history traversal", () => {
  const f = v2CandidateFixture();
  assert.deepEqual(promoteDocumentProvenance(f.baseline).facts, f.baseline.provenance.facts);
  assert.equal(f.document.schemaVersion, 2); assert.notEqual(f.document.id, f.baseline.id);
  assert.equal(JSON.stringify(f.document.sections[1]), JSON.stringify(validateDocumentationDocument(f.baseline).sections[1]));
  assert.deepEqual(f.document.provenance.revision.basedOn, { documentId: f.baseline.id, sha256: documentationHash(f.baseline) });
  assert.equal(f.document.provenance.contexts.length, 2);
  assert.equal(f.document.provenance.contexts.find(context => context.id === f.source.context.id)?.head, "d".repeat(40));
  assert.deepEqual(validateDocumentationDocument(JSON.parse(JSON.stringify(f.document))), f.document);
  const next = v2CandidateFixture(f.document);
  assert.equal(next.document.provenance.contexts.length, 2, "Unused previous revision context is pruned, historical retained support survives");
  assert.equal(next.document.provenance.revision.basedOn?.documentId, f.document.id);
  assert.ok(!JSON.stringify(next.document).includes('"schemaVersion":1'));
});

test("snapshot hashes ignore object-key order but preserve content, and IDs avoid collisions deterministically", () => {
  const baseline = draftFixture(), original = documentationHash(baseline);
  assert.equal(documentationHash(Object.fromEntries(Object.entries(baseline).reverse())), original);
  assert.notEqual(documentationHash({ ...baseline, title: "Changed" }), original);
  const impact = transformationImpactFixture(), id = randomUUID(), first = transformationSource(impact, id, []);
  const oldId = baseline.provenance.facts[0].id, newId = first.facts[0].id;
  baseline.provenance.facts[0].id = newId;
  baseline.sections.forEach(section => section.content.forEach(block => { block.factRefs = block.factRefs.map(ref => ref === oldId ? newId : ref); }));
  const second = transformationSource(impact, id, [baseline]);
  assert.notEqual(second.facts[0].id, newId);
  assert.deepEqual(second.facts, transformationSource(impact, id, [baseline]).facts);
  assert.equal(documentationId("stable"), documentationId("stable"));
});

test("v2 rejects cross-context citations, incorrect pinned commits, dangling contexts and rewritten revision identity", () => {
  const mutations: ((document: DocumentationDocumentV2) => void)[] = [
    doc => { doc.provenance.findings[0].contextId = randomUUID(); },
    doc => { doc.provenance.evidence[0].contextId = doc.provenance.contexts.find(context => context.id !== doc.provenance.evidence[0].contextId)!.id; },
    doc => { doc.provenance.evidence[0].side = "head"; doc.provenance.evidence[0].commitId = "f".repeat(40); },
    doc => { doc.provenance.revision.contextId = randomUUID(); },
    doc => { doc.provenance.revision.basedOn = { documentId: doc.id, sha256: "a".repeat(64) }; },
    doc => { doc.provenance.contexts.push({ ...doc.provenance.contexts[0], id: randomUUID() }); },
    doc => { doc.provenance.revision.decisionIds.push("decision-1"); },
    doc => { doc.provenance.limitations = []; },
  ];
  for (const mutate of mutations) { const doc = v2CandidateFixture().document; mutate(doc); assert.throws(() => validateDocumentationDocument(doc)); }
});

test("v2 named aggregate bounds accept their schema boundary and reject one extra item", () => {
  const doc = v2CandidateFixture().document;
  for (const [key, limit] of [["contexts", V2_MAX_CONTEXTS], ["facts", V2_MAX_FACTS], ["findings", V2_MAX_FINDINGS], ["evidence", V2_MAX_EVIDENCE]] as const) {
    const items: unknown[] = Array.from({ length: limit }, () => structuredClone(doc.provenance[key][0]));
    // Schema bounds tested independently; graph validation separately enforces
    // uniqueness/reachability and is intentionally not bypassed by this fixture.
    const copy = { ...doc, provenance: { ...doc.provenance, [key]: items } };
    assert.equal(documentV2Schema.safeParse(copy).success, true);
    items.push(structuredClone(items[0]));
    assert.equal(documentV2Schema.safeParse(copy).success, false);
  }
});

test("v2 retains the 128 KiB UTF-8 canonical boundary", () => {
  const doc = v2CandidateFixture().document;
  doc.provenance.limitations.push("");
  const bytes = DOCUMENTATION_DOCUMENT_MAX_BYTES - Buffer.byteLength(JSON.stringify(doc));
  doc.provenance.limitations[doc.provenance.limitations.length - 1] = "x".repeat(bytes);
  assert.equal(Buffer.byteLength(JSON.stringify(doc)), DOCUMENTATION_DOCUMENT_MAX_BYTES);
  assert.deepEqual(validateDocumentationDocument(doc), doc);
  doc.provenance.limitations[doc.provenance.limitations.length - 1] += "界";
  assert.throws(() => validateDocumentationDocument(doc), /128 KiB/);
});
