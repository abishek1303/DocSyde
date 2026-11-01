import { isDeepStrictEqual } from "node:util";
import type { DocumentationDocument } from "../documents/document";
import { transformationEntrySchema, type AuthoredSection, type TransformationChange } from "./documentation-change-proposal";
import type { TransformationAuthorization } from "./transformation-input";

export function authoredSections(change: TransformationChange): AuthoredSection[] {
  if (change.kind === "replace-section" || change.kind === "add-section") return [change.section];
  if (change.kind === "add-document") return change.sections;
  if (change.kind === "replace-document") return change.sections.flatMap(section => section.kind === "write" ? [section.section] : []);
  return [];
}

export function validateTransformationEntry(raw: unknown, auth: TransformationAuthorization, baseline?: DocumentationDocument) {
  const entry = transformationEntrySchema.parse(raw);
  if (entry.decisionId !== auth.decisionId || !isDeepStrictEqual(entry.target, auth.target)) throw new Error("Unauthorized decision target or snapshot.");
  const change = entry.change;
  if (change.kind === "incomplete") return change;
  if (change.kind !== auth.shape) throw new Error("Unauthorized transformation shape.");
  const sections = authoredSections(change), claims = new Set(auth.claims.map(claim => claim.id)), facts = new Map(auth.facts.map(fact => [fact.id, fact]));
  const associations = new Set(auth.associations.map(choice => choice.id)), usedClaims = new Set<string>();
  function refs(ids: string[], allowed: Set<string>) {
    if (new Set(ids).size !== ids.length || ids.some(id => !allowed.has(id))) throw new Error("Unauthorized or duplicate reference.");
  }
  for (const section of sections) {
    refs(section.associations, associations);
    for (const block of section.content) {
      refs(block.factRefs, new Set(facts.keys())); refs(block.claimRefs, claims);
      if (block.factRefs.some(ref => !facts.get(ref)!.claimRefs.some(id => block.claimRefs.includes(id)))
        || block.claimRefs.some(id => !block.factRefs.some(ref => facts.get(ref)!.claimRefs.includes(id)))) throw new Error("Fact/claim authorization mismatch.");
      block.claimRefs.forEach(id => usedClaims.add(id));
      if (/<[^>]*>|!\[|^\s*#|(?:javascript|data|vbscript):/im.test(block.markdown)) throw new Error("Unsupported generated markup.");
      const allowedText = [...auth.facts.map(fact => fact.value), ...auth.claims.flatMap(entry => [entry.claim.description, entry.claim.after ?? ""]), ...auth.associations.map(choice => choice.value)].join("\n");
      for (const match of block.markdown.matchAll(/(?:^|[\s(`"'])((?:https?:\/\/|\/)[^\s)`"'<>]*)/g)) {
        if (!allowedText.includes(match[1])) throw new Error("Unauthorized generated route or URL.");
      }
    }
  }
  if (auth.claims.some(claim => !usedClaims.has(claim.id))) throw new Error("Authorized claims left unaddressed.");
  if (change.kind === "add-document" || change.kind === "replace-document") refs(change.associations, associations);
  if (change.kind === "add-section") {
    const placement = change.placement;
    if ((placement.position === "undetermined") !== (placement.sectionId === null)
      || (placement.sectionId !== null && !baseline?.sections.some(section => section.id === placement.sectionId))) throw new Error("Invalid section placement.");
  }
  if (change.kind === "replace-document") {
    const ids = change.sections.flatMap(section => section.sectionId ? [section.sectionId] : []);
    if (!baseline || new Set(ids).size !== ids.length || ids.length !== baseline.sections.length
      || baseline.sections.some(section => !ids.includes(section.id))) throw new Error("Whole-document replacement must account for every original section exactly once.");
  }
  return change;
}

export type SupportUnit = { id: string; decisionId: string; text: string; claimRefs: string[]; factRefs: string[]; structural: boolean };
export function transformationSupportUnits(auth: TransformationAuthorization, change: TransformationChange, baseline?: DocumentationDocument): SupportUnit[] {
  const units: SupportUnit[] = [];
  const add = (text: string, claimRefs: string[], factRefs: string[], structural = false) => units.push({ id: `${auth.decisionId}-unit-${units.length + 1}`, decisionId: auth.decisionId, text, claimRefs: [...new Set(claimRefs)], factRefs: [...new Set(factRefs)], structural });
  if ((change.kind === "add-document" || change.kind === "replace-document") && change.title !== baseline?.title) add(change.title, auth.claims.map(claim => claim.id), auth.facts.map(fact => fact.id));
  for (const [index, section] of authoredSections(change).entries()) {
    const original = change.kind === "replace-section" ? baseline?.sections.find(section => section.id === auth.target.sectionId)
      : change.kind === "replace-document" ? baseline?.sections.find(section => section.id === change.sections.filter(section => section.kind === "write")[index]?.sectionId) : undefined;
    if (section.title !== original?.title) add(section.title, section.content.flatMap(block => block.claimRefs), section.content.flatMap(block => block.factRefs));
    section.content.forEach(block => add(block.markdown, block.claimRefs, block.factRefs));
  }
  if (change.kind === "add-section" && change.placement.position !== "undetermined") add(change.placement.reason, auth.claims.map(claim => claim.id), [], true);
  return units;
}
