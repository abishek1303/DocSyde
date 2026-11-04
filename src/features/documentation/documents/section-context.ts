import { z } from "zod";
import { productRouteEvidence } from "@/features/sources/product-routes";
import { associationChoice, draftProposal, type DocumentationDocument } from "./document";
import { validateDocumentationDocument } from "./document-validation";
import { documentationHash } from "./document-identity";

const ref = z.string().min(1).max(100);
export const sectionAssociationSchema = z.object({
  id: ref, kind: associationChoice.shape.kind, value: associationChoice.shape.value,
  scope: z.enum(["document", "section"]),
  provenance: z.discriminatedUnion("origin", [
    z.object({ origin: z.literal("explicit"), associationId: ref }).strict(),
    z.object({ origin: z.literal("discovery"), routeEvidence: productRouteEvidence }).strict(),
    z.object({ origin: z.literal("inferred"), findingId: ref,
      context: z.discriminatedUnion("version", [
        z.object({ version: z.literal(1), analysisId: z.uuid() }).strict(),
        z.object({ version: z.literal(2), evidenceContextId: z.uuid() }).strict(),
      ]),
    }).strict(),
  ]),
}).strict();
export const sectionContextSchema = z.object({
  documentId: z.uuid(), documentSha256: z.string().regex(/^[a-f0-9]{64}$/), sectionId: z.uuid(),
  documentTitle: draftProposal.shape.title, title: draftProposal.shape.sections.element.shape.title,
  purpose: draftProposal.shape.sections.element.shape.kind,
  text: z.string().max(3001), associations: z.array(sectionAssociationSchema).max(52),
}).strict();
export type SectionContext = z.infer<typeof sectionContextSchema>;

/** A derived snapshot projection, never canonical enrichment or factual authority.
 * Existing inferred associations resolve to historical findings; no new labels are generated. */
export function projectSectionContexts(raw: DocumentationDocument): SectionContext[] {
  const document = validateDocumentationDocument(raw), documentSha256 = documentationHash(document);
  return document.sections.map(section => {
    const documentAssociations = new Set(document.associations);
    const ids = new Set([...document.associations, ...section.associations]);
    const associations = document.context.filter(a => ids.has(a.id)).map(a => {
      const common = { id: a.id, kind: a.kind, value: a.value, scope: documentAssociations.has(a.id) ? "document" as const : "section" as const };
      if (a.origin === "operator") return { ...common, provenance: { origin: "explicit" as const, associationId: a.id } };
      // Canonical validation pins discovery proof to a document context. It is
      // route provenance, not a finding reference or an operator assertion.
      if (a.origin === "discovery") return { ...common, provenance: { origin: "discovery" as const, routeEvidence: a.routeEvidence } };
      const finding = document.provenance.findings.find(f => f.id === a.findingRef);
      if (!finding) throw new Error("Section association finding is unavailable.");
      const context = document.schemaVersion === 1 ? { version: 1 as const, analysisId: document.provenance.analysisId }
        : { version: 2 as const, evidenceContextId: document.provenance.findings.find(f => f.id === a.findingRef)!.contextId };
      return { ...common, provenance: { origin: "inferred" as const, findingId: finding.id, context } };
    });
    return sectionContextSchema.parse({ documentId: document.id, documentSha256, sectionId: section.id,
      documentTitle: document.title, title: section.title, purpose: section.kind, text: section.content.map(b => b.markdown).join("\n"), associations });
  });
}
