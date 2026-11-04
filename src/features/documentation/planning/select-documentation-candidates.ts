import "server-only";
import { z } from "zod";
import { searchDocumentationSections } from "@/integrations/database/documentation-drafts";
import type { ProductImpact } from "@/features/sources/product-analysis";
import { associationChoice, type DocumentationDocument } from "../documents/document";
import { getDocumentationDraft } from "../documents/operations";
import { documentationImpactCandidates } from "./documentation-impact-input";
import { candidateQuery, candidateSelectionSchema, matchSection, CANDIDATE_POOL_SECTION_LIMIT, CANDIDATE_POOL_DOCUMENT_LIMIT, CANDIDATE_POOL_BYTES, type CandidateSelection } from "./candidate-selection";
import { narrowDocumentationCandidates, sectionSourcePaths } from "./narrow-documentation-candidates";
import { projectSectionContexts } from "../documents/section-context";

export class CandidateSelectionIncompleteError extends Error {
  constructor(public readonly selection: CandidateSelection) { super(`Documentation candidate selection is incomplete: ${selection.diagnostics?.constraint ?? selection.diagnostics?.outcome ?? "plausible-candidates-exceed-limit"}; ${selection.diagnostics?.scannedSections ?? 0} section hits, ${selection.diagnostics?.scannedDocuments ?? 0} document hits.`); }
}

const hitSchema = z.object({ documentId: z.uuid(), sectionId: z.uuid() }).strict();
export async function selectDocumentationCandidates(impact: ProductImpact, {
  signal, context = [], publishedOnly = false,
}: { signal?: AbortSignal; context?: z.infer<typeof associationChoice>[]; publishedOnly?: boolean } = {}) {
  signal?.throwIfAborted();
  const explicit = z.array(associationChoice).max(20).parse(context);
  if (explicit.some(a => a.origin !== "operator" || a.findingRef || a.routeEvidence)) throw new Error("Candidate query context must be explicit operator associations.");
  const query = candidateQuery(impact, explicit), repository = impact.provenance.source.repository;
  const hits = z.array(hitSchema).max(CANDIDATE_POOL_SECTION_LIMIT + 1).parse(query.tokens.length || query.associations.length || query.sourcePaths?.length || query.priorTexts?.length ? await searchDocumentationSections(repository, query, CANDIDATE_POOL_SECTION_LIMIT + 1, publishedOnly) : []);
  signal?.throwIfAborted();
  if (new Set(hits.map(h => `${h.documentId}:${h.sectionId}`)).size !== hits.length) throw new Error("Duplicate section search hit.");
  const ids = [...new Set(hits.map(h => h.documentId))].sort();
  const incomplete = (outcome: "pool-limit" | "ambiguous", supportedDocuments = 0, constraint?: NonNullable<CandidateSelection["diagnostics"]>["constraint"]) => ({
    selection: candidateSelectionSchema.parse({ selectedDocumentIds: [], matches: [], coverage: "incomplete", broadFallbackUsed: false, reason: "plausible-candidates-exceed-limit",
      diagnostics: { outcome, ...(constraint ? { constraint } : {}), scannedSections: hits.length, scannedDocuments: ids.length, retainedSections: 0, retainedDocuments: 0, supportedDocuments } }), documents: [],
  });
  if (hits.length > CANDIDATE_POOL_SECTION_LIMIT) return incomplete("pool-limit", 0, "section-pool");
  if (ids.length > CANDIDATE_POOL_DOCUMENT_LIMIT) return incomplete("pool-limit", 0, "document-pool");
  if (!hits.length) {
    // Preserve broad loading's complete-list, corruption, repository and byte checks.
    const documents = await documentationImpactCandidates(repository, signal, publishedOnly);
    return { selection: candidateSelectionSchema.parse({ selectedDocumentIds: documents.map(d => d.id), matches: [], coverage: "complete", broadFallbackUsed: true, reason: "no-useful-matches" }), documents };
  }
  const loaded: DocumentationDocument[] = [];
  let bytes = 0;
  for (const id of ids) {
    signal?.throwIfAborted();
    const saved = await getDocumentationDraft(id, repository);
    signal?.throwIfAborted();
    if (saved.status !== "found" || saved.document.id !== id || saved.document.provenance.repository.toLowerCase() !== repository.toLowerCase()) throw new Error("Section search snapshot unavailable or mismatched.");
    bytes += Buffer.byteLength(JSON.stringify(saved.document));
    if (bytes > CANDIDATE_POOL_BYTES) return incomplete("pool-limit", 0, "snapshot-bytes");
    loaded.push(saved.document);
  }
  // Recompute explanations on validated canonical content; SQL never supplies authority or scores.
  const contexts = loaded.flatMap(projectSectionContexts);
  const matches = hits.map(hit => {
    const context = contexts.find(c => c.documentId === hit.documentId && c.sectionId === hit.sectionId);
    const document = loaded.find(document => document.id === hit.documentId);
    const match = context && document && matchSection(context, query, sectionSourcePaths(document, hit.sectionId));
    if (!match) throw new Error("Section search projection disagrees with the immutable snapshot.");
    return match;
  }).sort((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId) || a.sectionId.localeCompare(b.sectionId));
  const narrowed = narrowDocumentationCandidates(matches, query);
  if (narrowed.outcome === "ambiguous") return incomplete("ambiguous", narrowed.supportedDocuments, narrowed.constraint);
  const selection: CandidateSelection = candidateSelectionSchema.parse({ selectedDocumentIds: narrowed.ids, matches: narrowed.matches,
    diagnostics: { outcome: narrowed.outcome, scannedSections: hits.length, scannedDocuments: ids.length, retainedSections: narrowed.matches.length, retainedDocuments: narrowed.ids.length, supportedDocuments: narrowed.supportedDocuments }, coverage: "search-selected", broadFallbackUsed: false, reason: "deterministic-matches" });
  const documents = loaded.filter(document => narrowed.ids.includes(document.id)).map(document => ({ id: document.id, title: document.title,
    routes: document.context.filter(a => document.associations.includes(a.id) && a.kind === "route").map(a => a.value),
    sections: document.sections.map(section => ({ id: section.id, title: section.title, kind: section.kind,
      routes: document.context.filter(a => section.associations.includes(a.id) && a.kind === "route").map(a => a.value),
      associations: contexts.find(c => c.documentId === document.id && c.sectionId === section.id)!.associations.map(a => ({ kind: a.kind, value: a.value, origin: a.provenance.origin })),
      markdown: section.content.map(b => b.markdown),
    })),
  }));
  return { selection, documents };
}
