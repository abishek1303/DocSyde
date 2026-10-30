import { noGenerationContext } from "@/features/sources/generation-context";
import { randomUUID } from "node:crypto";
import { draftProposal, type DraftFacts, type DocumentationDocument } from "./document";
import { validateDocumentationDocument } from "./document-validation";
export function assembleDraft(raw: unknown, input: DraftFacts, model: string): DocumentationDocument {
  const proposal = draftProposal.parse(raw);
  const choices = new Map(input.context.map(c => [c.id, c]));
  const facts = new Map(input.facts.map(f => [f.id, f]));
  const sections = proposal.sections.map(section => {
    const used = section.content.flatMap(block => block.factRefs.map(id => { const f = facts.get(id); if (!f) throw new Error("Unknown fact reference."); return f; }));
    const findingRefs = [...new Set(used.map(f => f.findingRef))];
    for (const id of section.associations) {
      const choice = choices.get(id);
      if (!choice || (choice.findingRef && !findingRefs.includes(choice.findingRef))) throw new Error("Unknown or unrelated association.");
    }
    return { ...section, id: randomUUID(), findingRefs, qualifications: findingRefs.map(id => {
      const finding = input.provenance.findings.find(f => f.id === id);
      if (!finding) throw new Error("Unknown finding reference.");
      return { findingRef: id, ...finding.qualifications };
    }) };
  });
  for (const id of proposal.associations) if (!choices.has(id)) throw new Error("Unknown document association.");
  const factRefs = new Set(sections.flatMap(s => s.content.flatMap(b => b.factRefs)));
  const findingRefs = new Set(sections.flatMap(s => s.findingRefs));
  const associationRefs = new Set([...proposal.associations, ...sections.flatMap(s => s.associations)]);
  for (const id of associationRefs) { const c = choices.get(id)!; if (c.findingRef && !findingRefs.has(c.findingRef)) throw new Error("Association lacks a referenced finding."); }
  const findings = input.provenance.findings.filter(f => findingRefs.has(f.id));
  const evidenceIds = new Set(findings.flatMap(f => f.citations.map(c => c.evidenceId)));
  return validateDocumentationDocument({ id: randomUUID(), schemaVersion: 1, status: "draft", title: proposal.title, associations: proposal.associations, sections,
    context: input.context.filter(c => associationRefs.has(c.id)), provenance: { ...input.provenance, facts: input.facts.filter(f => factRefs.has(f.id)), findings, evidence: input.provenance.evidence.filter(e => evidenceIds.has(e.id)) }, generation: { ...(input.generationSnapshot ?? noGenerationContext), model, createdAt: new Date().toISOString() } });
}
