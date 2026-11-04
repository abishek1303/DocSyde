import { withValidationDiagnostic, type ValidationDiagnostic } from "@/integrations/ai/invocation-debug";
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

function rejectEntry(code: ValidationDiagnostic["code"], message: string, reference?: ValidationDiagnostic["reference"]): never {
  throw withValidationDiagnostic(new Error(message), { validator: "documentation-transformation", code, ...(reference ? { reference } : {}) });
}

export function validateTransformationEntry(raw: unknown, auth: TransformationAuthorization, baseline?: DocumentationDocument) {
  const parsed = transformationEntrySchema.safeParse(raw);
  if (!parsed.success) {
    // Diagnose only fixed schema fields and counts, never rejected identifiers.
    for (const issue of parsed.error.issues) {
      const fieldIndex = issue.path.findIndex(part => ["factRefs", "claimRefs", "associations"].includes(String(part)));
      if (fieldIndex < 0) continue;
      const field = issue.path[fieldIndex];
      const category = field === "factRefs" ? "factRefs" : field === "claimRefs" ? "claimRefs"
        : issue.path.includes("sections") || issue.path.includes("section") ? "section-associations" : "document-associations";
      let value: unknown = raw;
      for (const part of issue.path.slice(0, fieldIndex + 1)) value = value && typeof value === "object" && Object.hasOwn(value, part) ? Reflect.get(value, part) : undefined;
      rejectEntry("unauthorized-reference", "Malformed reference array.", { category, reason: value === undefined || Array.isArray(value) && value.length === 0 ? "missing" : "malformed" });
    }
    throw parsed.error;
  }
  const entry = parsed.data;
  if (entry.decisionId !== auth.decisionId || !isDeepStrictEqual(entry.target, auth.target)) rejectEntry("unauthorized-decision-target", "Unauthorized decision target or snapshot.", { category: "identity", reason: "mismatched" });
  const change = entry.change;
  if (change.kind === "incomplete") return change;
  if (change.kind !== auth.shape) rejectEntry("unauthorized-transformation-shape", "Unauthorized transformation shape.");
  const sections = authoredSections(change), claims = new Set(auth.claims.map(claim => claim.id)), facts = new Map(auth.facts.map(fact => [fact.id, fact]));
  const associations = new Set(auth.associations.map(choice => choice.id)), usedClaims = new Set<string>();
  function refs(ids: string[], allowed: Set<string>, category: NonNullable<ValidationDiagnostic["reference"]>["category"]) {
    const diagnostic = { category, allowedCount: allowed.size, receivedCount: ids.length };
    if (new Set(ids).size !== ids.length) rejectEntry("unauthorized-reference", "Duplicate reference within one array.", { ...diagnostic, reason: "duplicate-in-array" });
    if (ids.some(id => !allowed.has(id))) rejectEntry("unauthorized-reference", "Reference is not authorized for this guide.", { ...diagnostic, reason: "unknown-in-guide" });
  }
  for (const section of sections) {
    refs(section.associations, associations, "section-associations");
    for (const block of section.content) {
      refs(block.factRefs, new Set(facts.keys()), "factRefs"); refs(block.claimRefs, claims, "claimRefs");
      if (block.factRefs.some(ref => !facts.get(ref)!.claimRefs.some(id => block.claimRefs.includes(id)))
        || block.claimRefs.some(id => !block.factRefs.some(ref => facts.get(ref)!.claimRefs.includes(id)))) rejectEntry("fact-claim-mismatch", "Fact/claim authorization mismatch.", { category: "factRefs", reason: "fact-claim-mismatch" });
      block.claimRefs.forEach(id => usedClaims.add(id));
      if (/<[^>]*>|!\[|^\s*#|(?:javascript|data|vbscript):/im.test(block.markdown)) rejectEntry("unsupported-markup", "Unsupported generated markup.");
      const allowedText = [...auth.facts.map(fact => fact.value), ...auth.claims.flatMap(entry => [entry.claim.description, entry.claim.after ?? ""]), ...auth.associations.map(choice => choice.value)].join("\n");
      for (const match of block.markdown.matchAll(/(?:^|[\s(`"'])((?:https?:\/\/|\/)[^\s)`"'<>]*)/g)) {
        if (!allowedText.includes(match[1])) rejectEntry("unauthorized-generated-route", "Unauthorized generated route or URL.");
      }
    }
  }
  if (auth.claims.some(claim => !usedClaims.has(claim.id))) rejectEntry("unaddressed-claims", "Authorized claims left unaddressed.", { category: "claimRefs", reason: "missing", allowedCount: claims.size, receivedCount: usedClaims.size });
  if (change.kind === "add-document" || change.kind === "replace-document") refs(change.associations, associations, "document-associations");
  if (change.kind === "add-section") {
    const placement = change.placement;
    if ((placement.position === "undetermined") !== (placement.sectionId === null)
      || (placement.sectionId !== null && !baseline?.sections.some(section => section.id === placement.sectionId))) rejectEntry("invalid-section-placement", "Invalid section placement.");
  }
  if (change.kind === "replace-document") {
    const ids = change.sections.flatMap(section => section.sectionId ? [section.sectionId] : []);
    if (!baseline || new Set(ids).size !== ids.length || ids.length !== baseline.sections.length
      || baseline.sections.some(section => !ids.includes(section.id))) rejectEntry("incomplete-section-accounting", "Whole-document replacement must account for every original section exactly once.");
  }
  return change;
}

export type SupportUnit = { id: string; decisionId: string; text: string; originalText?: string; claimRefs: string[]; factRefs: string[]; structural: boolean };
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
