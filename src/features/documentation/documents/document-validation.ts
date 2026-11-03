import { isDeepStrictEqual } from "node:util";
import { documentSchema, type DocumentationDocument } from "./document";
import { DOCUMENTATION_DOCUMENT_MAX_BYTES } from "../drafts/draft-limits";

export function assertDocumentBytes(serialized: string): void {
  if (Buffer.byteLength(serialized, "utf8") > DOCUMENTATION_DOCUMENT_MAX_BYTES) {
    throw new Error("Canonical document exceeds 128 KiB.");
  }
}

function requireIntegrity(valid: boolean): asserts valid {
  if (!valid) throw new Error("Canonical document integrity check failed.");
}

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  const map = new Map(items.map(item => [item.id, item]));
  requireIntegrity(map.size === items.length);
  return map;
}

function sameReferences(actual: string[], expected: Set<string>): boolean {
  return actual.length === expected.size && actual.every(id => expected.has(id));
}

// Checks only the retained canonical graph. Source-body/excerpt verification and
// semantic eligibility remain upstream; neither is reproducible from this snapshot.
export function validateDocumentationDocument(raw: unknown): DocumentationDocument {
  const serialized = JSON.stringify(raw);
  requireIntegrity(typeof serialized === "string");
  assertDocumentBytes(serialized);
  const document = documentSchema.parse(raw);
  requireIntegrity(document.sections.length >= 1 && document.sections.length <= 4);
  requireIntegrity(document.associations.length <= 20);
  byId(document.sections);
  requireIntegrity(document.sections.every(section => section.id !== document.id));
  const context = byId(document.context);
  const facts = byId(document.provenance.facts);
  const findings = byId(document.provenance.findings);
  const evidence = byId(document.provenance.evidence);
  // Existing assembly bounds: four findings × three fact fields/four citations,
  // plus twenty operator associations and two context labels per finding.
  if (document.schemaVersion === 1) requireIntegrity(context.size <= 28 && facts.size <= 12 && findings.size <= 4 && evidence.size <= 16);
  const usedFacts = new Set<string>();
  const usedFindings = new Set<string>();
  const usedContext = new Set(document.associations);

  for (const section of document.sections) {
    const sectionFindings = new Set<string>();
    for (const block of section.content) {
      for (const ref of block.factRefs) {
        const fact = facts.get(ref);
        requireIntegrity(!!fact);
        const finding = findings.get(fact.findingRef);
        requireIntegrity(!!finding);
        requireIntegrity(fact.value === finding[fact.field]);
        requireIntegrity(isDeepStrictEqual(fact.qualifications, finding.qualifications));
        usedFacts.add(ref);
        usedFindings.add(fact.findingRef);
        sectionFindings.add(fact.findingRef);
      }
    }
    requireIntegrity(sameReferences(section.findingRefs, sectionFindings));
    requireIntegrity(new Set(section.findingRefs).size === section.findingRefs.length);
    requireIntegrity(sameReferences(section.qualifications.map(q => q.findingRef), sectionFindings));
    requireIntegrity(new Set(section.qualifications.map(q => q.findingRef)).size === section.qualifications.length);
    for (const { findingRef, ...qualification } of section.qualifications) {
      requireIntegrity(isDeepStrictEqual(qualification, findings.get(findingRef)?.qualifications));
    }
    for (const ref of section.associations) {
      const choice = context.get(ref);
      requireIntegrity(!!choice && (!choice.findingRef || sectionFindings.has(choice.findingRef)));
      usedContext.add(ref);
    }
  }
  requireIntegrity(sameReferences([...facts.keys()], usedFacts));
  requireIntegrity(sameReferences([...context.keys()], usedContext));
  // A retained finding-origin association can keep its historical support even
  // after its last prose block is replaced. It cannot authorize new prose.
  if (document.schemaVersion === 2) for (const choice of context.values()) {
    if (choice.findingRef) { requireIntegrity(findings.has(choice.findingRef)); usedFindings.add(choice.findingRef); }
  }
  requireIntegrity(sameReferences([...findings.keys()], usedFindings));
  for (const choice of context.values()) {
    requireIntegrity(choice.origin === "operator" ? !choice.findingRef : !!choice.findingRef && usedFindings.has(choice.findingRef));
    if (choice.kind === "route" && choice.origin === "operator") {
      requireIntegrity(choice.value.startsWith("/") && !choice.value.startsWith("//") && !/[?#\x00-\x20]/.test(choice.value));
    }
  }
  const usedEvidence = new Set<string>();
  for (const finding of findings.values()) {
    requireIntegrity(finding.citations.length >= 1 && finding.citations.length <= 4);
    for (const citation of finding.citations) {
      requireIntegrity(evidence.has(citation.evidenceId) && citation.endLine >= citation.startLine);
      usedEvidence.add(citation.evidenceId);
    }
  }
  requireIntegrity(sameReferences([...evidence.keys()], usedEvidence));
  if (document.schemaVersion === 2) {
    const contexts = byId(document.provenance.contexts), used = new Set<string>([document.provenance.revision.contextId]);
    requireIntegrity(contexts.has(document.provenance.revision.contextId));
    requireIntegrity(document.provenance.revision.basedOn?.documentId !== document.id);
    requireIntegrity(new Set(document.provenance.revision.decisionIds).size === document.provenance.revision.decisionIds.length);
    for (const finding of document.provenance.findings) {
      requireIntegrity(contexts.has(finding.contextId)); used.add(finding.contextId);
      for (const citation of finding.citations) requireIntegrity(document.provenance.evidence.find(e => e.id === citation.evidenceId)?.contextId === finding.contextId);
    }
    for (const entry of document.provenance.evidence) {
      const source = contexts.get(entry.contextId); requireIntegrity(!!source); used.add(entry.contextId);
      requireIntegrity(entry.commitId === (entry.side === "patch" ? null : source[entry.side]));
    }
    requireIntegrity(sameReferences([...contexts.keys()], used));
    requireIntegrity(document.provenance.limited === document.provenance.contexts.some(source => source.limited));
    requireIntegrity(document.provenance.contexts.every(source => source.limitations.every(limit => document.provenance.limitations.includes(limit))));
  }
  const imageIds = document.sections.flatMap(section => (section.images ?? []).map(image => image.id));
  requireIntegrity(new Set(imageIds).size === imageIds.length);
  return document;
}
