import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { draftFixture } from "../../../infra/local/documentation/draft-fixture";
import { validateDocumentationDocument, assertDocumentBytes } from "./document-validation";
import { signDraftPreview, verifyDraftPreview } from "./draft-handoff";
import { DOCUMENTATION_DOCUMENT_MAX_BYTES } from "./draft-limits";
import type { DocumentationDocument } from "./document";

test("canonical graph validates without changing identities or consulting source bodies", t => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected external call"); });
  const document = draftFixture();
  assert.deepEqual(validateDocumentationDocument(document), document);
  // Retained excerpt validity against an absent source body is upstream's job.
  document.provenance.findings[0].citations[0].excerpt = "Different retained excerpt";
  assert.deepEqual(validateDocumentationDocument(document), document);
});

test("rejects broken canonical graphs, duplicate identities and inconsistent retained qualifications", () => {
  const mutations: ((document: DocumentationDocument) => void)[] = [
    d => { d.sections = []; },
    d => { d.sections.push(structuredClone(d.sections[0])); },
    d => { d.sections[0].id = d.id; },
    d => { d.context.push(structuredClone(d.context[0])); },
    d => { d.provenance.facts.push(structuredClone(d.provenance.facts[0])); },
    d => { d.provenance.findings.push(structuredClone(d.provenance.findings[0])); },
    d => { d.provenance.evidence.push(structuredClone(d.provenance.evidence[0])); },
    d => { d.sections[0].content[0].factRefs = ["missing"]; },
    d => { d.provenance.facts[0].findingRef = "missing"; },
    d => { d.provenance.facts[0].value = "Invented"; },
    d => { d.provenance.facts[0].qualifications.confidence = "high"; },
    d => { d.sections[0].qualifications[0].uncertainties = []; },
    d => { d.sections[0].findingRefs = []; },
    d => { d.sections[0].qualifications = []; },
    d => { d.associations = ["missing"]; },
    d => { d.context[1].findingRef = "missing"; },
    d => { d.context[0].findingRef = "finding-1"; },
    d => { d.context[0].value = "//invalid"; },
    d => { d.provenance.findings[0].citations[0].evidenceId = "missing"; },
    d => { d.provenance.findings[0].citations[0].startLine = 2; },
    d => { d.provenance.evidence.push({ ...d.provenance.evidence[0], id: "unused" }); },
  ];
  for (const mutate of mutations) {
    const document = draftFixture(); mutate(document);
    assert.throws(() => validateDocumentationDocument(document), Error, mutate.toString());
  }
  assert.throws(() => validateDocumentationDocument({ ...draftFixture(), schemaVersion: 2 }));
  assert.throws(() => validateDocumentationDocument({ ...draftFixture(), extra: "unrecognized" }));
});

test("128 KiB is a UTF-8 serialized byte boundary, including Unicode", () => {
  const document = draftFixture();
  const padding = DOCUMENTATION_DOCUMENT_MAX_BYTES - Buffer.byteLength(JSON.stringify(document));
  document.provenance.limitations[0] += "x".repeat(padding);
  assert.equal(Buffer.byteLength(JSON.stringify(document)), DOCUMENTATION_DOCUMENT_MAX_BYTES);
  assert.deepEqual(validateDocumentationDocument(document), document);
  document.provenance.limitations[0] += "λ";
  assert.throws(() => validateDocumentationDocument(document), /128 KiB/);
  assert.throws(() => assertDocumentBytes("λ".repeat(DOCUMENTATION_DOCUMENT_MAX_BYTES / 2 + 1)), /128 KiB/);
});

test("maximum section/block content fits the canonical byte limit", () => {
  const document = draftFixture();
  document.sections = Array.from({ length: 4 }, (_, i) => ({ ...structuredClone(document.sections[0]), id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, content: Array.from({ length: 2 }, () => ({ markdown: "界".repeat(1500), factRefs: ["fact-after"] })) }));
  assert.deepEqual(validateDocumentationDocument(document), document);
});

test("handoff verifies exact signed bytes before parsing and detects tampering", t => {
  const previous = process.env.DOCSYDE_DRAFT_SIGNING_KEY;
  const key = "test-only-documentation-signing-key-32";
  process.env.DOCSYDE_DRAFT_SIGNING_KEY = key;
  t.after(() => { if (previous === undefined) delete process.env.DOCSYDE_DRAFT_SIGNING_KEY; else process.env.DOCSYDE_DRAFT_SIGNING_KEY = previous; });
  const document = draftFixture(); document.title += " λ";
  const preview = signDraftPreview(document);
  assert.deepEqual(verifyDraftPreview(preview.serialized, preview.signature), document);
  assert.equal(preview.serialized, JSON.stringify(validateDocumentationDocument(document)));
  assert.ok(!("signature" in document));
  for (const modified of [preview.serialized + " ", preview.serialized.replace("λ", "x"), "not json"]) {
    assert.throws(() => verifyDraftPreview(modified, preview.signature), /signature/);
  }
  // Whitespace is accepted only when those exact bytes were signed.
  const spaced = JSON.stringify(document, null, 2);
  assert.deepEqual(verifyDraftPreview(spaced, createHmac("sha256", key).update(spaced).digest("hex")), document);
  assert.throws(() => verifyDraftPreview("not json", createHmac("sha256", key).update("not json").digest("hex")), SyntaxError);
  for (const signature of ["", "00", "z".repeat(64), "0".repeat(64), null]) assert.throws(() => verifyDraftPreview(preview.serialized, signature));
  delete process.env.DOCSYDE_DRAFT_SIGNING_KEY;
  assert.throws(() => signDraftPreview(document), /SIGNING_KEY/);
  assert.throws(() => verifyDraftPreview(preview.serialized, preview.signature), /SIGNING_KEY/);
});
