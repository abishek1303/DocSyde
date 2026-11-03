import "server-only";
import { compositionOutputSchema, type CompositionOutput } from "@/integrations/ai/composition-output";
import type { DocumentationDocument } from "../documents/document";
import type { TransformationChange } from "./documentation-change-proposal";
import type { TransformationAuthorization } from "./transformation-input";
import { authoredSections, validateTransformationEntry } from "./transformation-validation";

/** Only candidate text, its authorized claims/facts, and a short target outline. No raw evidence or advisory run context. */
export function compositionInput(change: TransformationChange, auth: TransformationAuthorization, baseline?: DocumentationDocument, terminology: string[] = []) {
  return JSON.stringify({ terminology: terminology.filter(term => term.length <= 200).slice(0, 8), sections: authoredSections(change).map((section, sectionRef) => ({ sectionRef, title: section.title,
    content: section.content.map((block, blockRef) => ({ blockRef, markdown: block.markdown,
      facts: auth.facts.filter(fact => block.factRefs.includes(fact.id)).map(fact => ({ value: fact.value, qualifications: fact.qualifications })),
      claims: auth.claims.filter(claim => block.claimRefs.includes(claim.id)).map(({ claim }) => ({ description: claim.description, after: claim.after, uncertainties: claim.uncertainties })),
    })), })), existingDocument: baseline ? { title: baseline.title, sections: baseline.sections.map(({ title, kind }) => ({ title, kind })) } : null });
}

/** Reattach server-owned evidence and mutation permissions; never accept model-authored refs. */
export function applyComposition(change: TransformationChange, raw: CompositionOutput, auth: TransformationAuthorization, baseline?: DocumentationDocument) {
  const output = compositionOutputSchema.parse(raw), composed = structuredClone(change), sections = authoredSections(composed);
  if (output.sections.length !== sections.length || new Set(output.sections.map(s => s.sectionRef)).size !== sections.length) throw new Error("Composition section correspondence.");
  for (const section of output.sections) {
    const original = sections[section.sectionRef];
    if (!original || section.content.length !== original.content.length || new Set(section.content.map(b => b.blockRef)).size !== original.content.length) throw new Error("Composition block correspondence.");
    original.title = section.title;
    for (const block of section.content) {
      if (!original.content[block.blockRef]) throw new Error("Unknown composition block.");
      original.content[block.blockRef].markdown = block.parts.map(part => part.kind === "paragraph" ? part.text
        : part.items.map((item, index) => `${part.kind === "steps" ? `${index + 1}.` : "-"} ${item}`).join("\n")).join("\n\n");
    }
  }
  return validateTransformationEntry({ decisionId: auth.decisionId, target: auth.target, change: composed }, auth, baseline);
}
