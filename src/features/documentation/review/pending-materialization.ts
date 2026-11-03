import "server-only";
import type { DocumentationDocument } from "../documents/document";
import { documentationHash, documentationId } from "../documents/document-identity";
import { validateDocumentationDocument } from "../documents/document-validation";
import { assembleDocumentationChange } from "../transformation/assemble-documentation-change";
import { transformationSource } from "../transformation/transformation-input";
import { authoredSections } from "../transformation/transformation-validation";
import { intrinsicReviewReady, proposalOperatorContext } from "./materialize-approved-changes";
import type { ImageSuggestion } from "../images/document-image-operations";
import type { DocumentationChangeProposal, DecisionResult } from "../transformation/documentation-change-proposal";

export type PendingEdit = { proposal: DocumentationChangeProposal; results: DecisionResult[] };
/** Reuse canonical assembly, preserving each proposal's validated facts in a distinct namespace.
 * No model calls or semantic rewriting. The final revision points to the persisted base,
 * while each original review receipt links its decisions to the combined publication. */
export function materializePendingEdits(edits: PendingEdit[], baseline?: DocumentationDocument, options: { suggestions?: Map<string, ImageSuggestion[]>; removedImages?: string[] } = {}) {
  let document = baseline;
  for (const { proposal, results } of edits) {
    if (results.some(result => !intrinsicReviewReady(proposal, result))) throw new Error("Unsupported change.");
    const source = transformationSource(proposal.impact, proposal.proposalId, proposal.targets.map(target => target.document));
    const id = (kind: string, value: string) => documentationId(`${proposal.proposalId}:${kind}:${value}`);
    const facts = new Map(source.facts.map(fact => [fact.id, id("fact", fact.id)]));
    source.facts = source.facts.map(fact => ({ ...fact, id: facts.get(fact.id)!, findingRef: id("finding", fact.findingRef) }));
    source.findings = source.findings.map(finding => ({ ...finding, id: id("finding", finding.id), citations: finding.citations.map(citation => ({ ...citation, evidenceId: id("evidence", citation.evidenceId) })) }));
    source.evidence = source.evidence.map(evidence => ({ ...evidence, id: id("evidence", evidence.id) }));
    const copied = structuredClone(results);
    for (const result of copied) if (result.change) for (const section of authoredSections(result.change)) for (const block of section.content) block.factRefs = block.factRefs.map(ref => facts.get(ref) ?? ref);
    // Finding-origin associations refer to this same remapped source catalog.
    const context = proposalOperatorContext(proposal, results).map(choice => ({ ...choice, ...(choice.findingRef ? { findingRef: id("finding", choice.findingRef) } : {}) }));
    const namespace = documentationId(documentationHash({ edits: edits.map(edit => [edit.proposal.proposalId, edit.results.map(result => result.decisionId)]), step: proposal.proposalId }));
    document = assembleDocumentationChange({ proposalId: namespace, createdAt: proposal.createdAt,
      planSha256: proposal.planSha256, baseline: document, results: copied, source, suppliedContext: context, limitations: [...new Set(results.flatMap(result => result.limitations))] });
    for (const result of results) {
      const change = result.change!;
      const ids = change.kind === "replace-section" ? [result.decision.sectionId!]
        : change.kind === "add-section" ? [documentationId(`${namespace}:${result.decisionId}:section`)]
        : change.kind === "add-document" ? change.sections.map((_, index) => documentationId(`${namespace}:${result.decisionId}:section:${index}`))
        : change.kind === "replace-document" ? change.sections.flatMap((entry, index) => entry.kind === "retain" ? [] : [entry.sectionId ?? documentationId(`${namespace}:${result.decisionId}:section:${index}`)]) : [];
      for (const suggestion of options.suggestions?.get(proposal.proposalId) ?? []) if (suggestion.decisionId === result.decisionId && !options.removedImages?.includes(suggestion.image.id)) {
        const section = document.sections.find(section => section.id === ids[suggestion.sectionIndex]);
        if (section) section.images = [...(section.images ?? []), suggestion.image].slice(0, 3);
      }
    }
  }
  if (!document || document.schemaVersion !== 2) throw new Error("No publishable document.");
  for (const section of document.sections) if (section.images) {
    section.images = section.images.filter(image => !options.removedImages?.includes(image.id));
    if (!section.images.length) delete section.images;
  }
  const imageIdentity = document.sections.flatMap(section => (section.images ?? []).map(image => [section.id, image]));
  if (imageIdentity.length || (baseline?.sections.some(section => section.images?.length) && options.removedImages?.length)) document.id = documentationId(`${document.id}:images:${documentationHash(imageIdentity)}`);
  document.provenance.revision.basedOn = baseline ? { documentId: baseline.id, sha256: documentationHash(baseline) } : null;
  return validateDocumentationDocument(document);
}
