import { isDeepStrictEqual } from "node:util";
import { documentV2Schema, type DocumentationDocument, type DocumentationDocumentV2, type AssociationChoice } from "../documents/document";
import { validateDocumentationDocument } from "../documents/document-validation";
import { documentationHash, documentationId } from "../documents/document-identity";
import type { AuthoredSection, DecisionResult } from "./documentation-change-proposal";
import type { TransformationSource } from "./transformation-input";

export function promoteDocumentProvenance(document: DocumentationDocument): Omit<DocumentationDocumentV2["provenance"], "revision"> {
  const baseline = validateDocumentationDocument(document);
  if (baseline.schemaVersion === 2) {
    const { revision: _revision, ...provenance } = baseline.provenance;
    // Retain no nested snapshot/history. The new revision replaces this pointer.
    void _revision;
    return structuredClone(provenance);
  }
  const p = baseline.provenance;
  return { repository: p.repository, limited: p.limited, limitations: [...p.limitations],
    contexts: [{ id: p.analysisId, base: p.base, head: p.head, assessment: p.assessment, limited: p.limited, limitations: [...p.limitations] }],
    facts: structuredClone(p.facts), findings: p.findings.map(finding => ({ ...structuredClone(finding), contextId: p.analysisId })),
    evidence: p.evidence.map(evidence => ({ ...structuredClone(evidence), contextId: p.analysisId })) };
}

function unique<T extends { id: string }>(entries: T[]): T[] {
  const items = new Map<string, T>();
  for (const entry of entries) {
    if (items.has(entry.id) && !isDeepStrictEqual(items.get(entry.id), entry)) throw new Error("Conflicting canonical identity.");
    items.set(entry.id, entry);
  }
  return [...items.values()];
}

export function assembleDocumentationChange({ proposalId, createdAt, planSha256, baseline, results, source, suppliedContext, limitations }: {
  proposalId: string; createdAt: string; planSha256: string; baseline?: DocumentationDocument;
  results: DecisionResult[]; source: TransformationSource; suppliedContext: AssociationChoice[]; limitations: string[];
}): DocumentationDocumentV2 {
  if (baseline && baseline.provenance.repository.toLowerCase() !== source.repository.toLowerCase()) throw new Error("Materialization repository mismatch.");
  const old = baseline ? promoteDocumentProvenance(baseline) : undefined;
  const facts = unique([...(old?.facts ?? []), ...source.facts]), findings = unique([...(old?.findings ?? []), ...source.findings]);
  const evidence = unique([...(old?.evidence ?? []), ...source.evidence]);
  const contexts = unique([...(old?.contexts ?? []), source.context]);
  let title = baseline?.title ?? "", associations = [...(baseline?.associations ?? [])];
  let sections: DocumentationDocument["sections"] = structuredClone(baseline?.sections ?? []);
  const context = unique([...(baseline?.context ?? []), ...suppliedContext]);
  function section(body: AuthoredSection, id: string): DocumentationDocument["sections"][number] {
    const findingRefs = [...new Set(body.content.flatMap(block => block.factRefs.map(ref => {
      const fact = facts.find(fact => fact.id === ref); if (!fact) throw new Error("Unknown materialization fact."); return fact.findingRef;
    })))];
    return { id, title: body.title, kind: body.kind, associations: [...body.associations],
      content: body.content.map(block => ({ markdown: block.markdown, factRefs: [...block.factRefs] })), findingRefs,
      qualifications: findingRefs.map(findingRef => {
        const finding = findings.find(finding => finding.id === findingRef); if (!finding) throw new Error("Unknown materialization finding.");
        return { findingRef, ...structuredClone(finding.qualifications) };
      }) };
  }
  const placements = new Set<string>();
  for (const result of results) {
    if (!result.reviewReady || !result.change || result.change.kind === "incomplete") throw new Error("Incomplete changes cannot materialize.");
    const change = result.change;
    if (change.kind === "replace-section") {
      const index = sections.findIndex(section => section.id === result.decision.sectionId);
      if (index < 0) throw new Error("Missing section target.");
      sections[index] = section(change.section, sections[index].id);
    } else if (change.kind === "add-section") {
      const placement = change.placement;
      if (placement.position === "undetermined") throw new Error("Section placement is unresolved.");
      const key = `${placement.position}:${placement.sectionId}`;
      if (placements.has(key)) throw new Error("Multiple additions have ambiguous relative placement."); placements.add(key);
      const index = sections.findIndex(section => section.id === placement.sectionId);
      if (index < 0) throw new Error("Missing placement anchor.");
      sections.splice(index + (placement.position === "after" ? 1 : 0), 0, section(change.section, documentationId(`${proposalId}:${result.decisionId}:section`)));
    } else if (change.kind === "replace-document") {
      if (!baseline || results.length !== 1) throw new Error("Conflicting whole-document changes.");
      title = change.title; associations = [...change.associations];
      sections = change.sections.map((entry, index) => {
        if (entry.kind === "retain") {
          const original = baseline.sections.find(section => section.id === entry.sectionId); if (!original) throw new Error("Unknown retained section.");
          return structuredClone(original);
        }
        return section(entry.section, entry.sectionId ?? documentationId(`${proposalId}:${result.decisionId}:section:${index}`));
      });
    } else {
      if (baseline) throw new Error("Conflicting new-document changes.");
      if (!title) title = change.title;
      associations = [...new Set([...associations, ...change.associations])];
      sections.push(...change.sections.map((body, index) => section(body, documentationId(`${proposalId}:${result.decisionId}:section:${index}`))));
    }
  }
  const usedFacts = new Set(sections.flatMap(section => section.content.flatMap(block => block.factRefs)));
  const usedContext = new Set([...associations, ...sections.flatMap(section => section.associations)]);
  const keptContext = context.filter(choice => usedContext.has(choice.id));
  const keptFacts = facts.filter(fact => usedFacts.has(fact.id));
  const usedFindings = new Set([...keptFacts.map(fact => fact.findingRef), ...keptContext.flatMap(choice => choice.findingRef ? [choice.findingRef] : [])]);
  const keptFindings = findings.filter(finding => usedFindings.has(finding.id));
  const usedEvidence = new Set(keptFindings.flatMap(finding => finding.citations.map(citation => citation.evidenceId)));
  const keptEvidence = evidence.filter(entry => usedEvidence.has(entry.id));
  const usedContexts = new Set([source.context.id, ...keptFindings.map(finding => finding.contextId), ...keptEvidence.map(entry => entry.contextId)]);
  const keptContexts = contexts.filter(context => usedContexts.has(context.id));
  const models = [...new Set(results.flatMap(result => result.model ? [result.model.model] : []))];
  if (models.length !== 1) throw new Error("A candidate requires consistent generation model metadata.");
  const candidate = documentV2Schema.parse({ id: documentationId(`${proposalId}:document:${baseline?.id ?? results[0].decisionId}`),
    schemaVersion: 2, status: "draft", title, associations, sections, context: keptContext,
    provenance: { repository: baseline?.provenance.repository ?? source.repository,
      limitations: [...new Set([...(old?.limitations ?? []), ...keptContexts.flatMap(context => context.limitations), ...limitations,
        ...(baseline ? ["Retained baseline content was preserved, not reverified by this revision."] : [])])],
      limited: keptContexts.some(context => context.limited), contexts: keptContexts,
      facts: keptFacts, findings: keptFindings, evidence: keptEvidence,
      revision: { contextId: source.context.id, basedOn: baseline ? { documentId: baseline.id, sha256: documentationHash(baseline) } : null,
        planSha256, decisionIds: results.map(result => result.decisionId) } },
    generation: { model: models[0], createdAt },
  });
  const validated = validateDocumentationDocument(candidate);
  if (validated.schemaVersion !== 2) throw new Error("Expected canonical v2.");
  return validated;
}
