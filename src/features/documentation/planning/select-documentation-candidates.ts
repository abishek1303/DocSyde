import "server-only";
import { z } from "zod";
import { searchDocumentationSections } from "@/integrations/database/documentation-drafts";
import type { ProductImpact } from "@/features/sources/product-analysis";
import { associationChoice, type DocumentationDocument } from "../documents/document";
import { getDocumentationDraft } from "../documents/operations";
import { documentationImpactCandidates } from "./documentation-impact-input";
import { candidateQuery, candidateSelectionSchema, matchSection, CANDIDATE_DOCUMENT_LIMIT, CANDIDATE_SECTION_LIMIT, type CandidateSelection } from "./candidate-selection";
import { projectSectionContexts } from "../documents/section-context";

export class CandidateSelectionIncompleteError extends Error {
  constructor(public readonly selection: CandidateSelection) { super("Documentation candidate selection is incomplete: plausible candidates exceed bounds."); }
}

const hitSchema = z.object({ documentId: z.uuid(), sectionId: z.uuid() }).strict();
export async function selectDocumentationCandidates(impact: ProductImpact, {
  signal, context = [], publishedOnly = false,
}: { signal?: AbortSignal; context?: z.infer<typeof associationChoice>[]; publishedOnly?: boolean } = {}) {
  signal?.throwIfAborted();
  const explicit = z.array(associationChoice).max(20).parse(context);
  if (explicit.some(a => a.origin !== "operator" || a.findingRef)) throw new Error("Candidate query context must be explicit operator associations.");
  const query = candidateQuery(impact, explicit), repository = impact.provenance.source.repository;
  const hits = z.array(hitSchema).max(CANDIDATE_SECTION_LIMIT + 1).parse(query.tokens.length || query.associations.length ? await searchDocumentationSections(repository, query, CANDIDATE_SECTION_LIMIT + 1, publishedOnly) : []);
  signal?.throwIfAborted();
  if (new Set(hits.map(h => `${h.documentId}:${h.sectionId}`)).size !== hits.length) throw new Error("Duplicate section search hit.");
  const ids = [...new Set(hits.map(h => h.documentId))].sort();
  if (hits.length > CANDIDATE_SECTION_LIMIT || ids.length > CANDIDATE_DOCUMENT_LIMIT) {
    return { selection: candidateSelectionSchema.parse({ selectedDocumentIds: [], matches: [], coverage: "incomplete", broadFallbackUsed: false, reason: "plausible-candidates-exceed-limit" }), documents: [] };
  }
  if (!hits.length) {
    // Preserve broad loading's complete-list, corruption, repository and byte checks.
    const documents = await documentationImpactCandidates(repository, signal, publishedOnly);
    return { selection: candidateSelectionSchema.parse({ selectedDocumentIds: documents.map(d => d.id), matches: [], coverage: "complete", broadFallbackUsed: true, reason: "no-useful-matches" }), documents };
  }
  const loaded: DocumentationDocument[] = [];
  for (const id of ids) {
    signal?.throwIfAborted();
    const saved = await getDocumentationDraft(id, repository);
    signal?.throwIfAborted();
    if (saved.status !== "found" || saved.document.id !== id || saved.document.provenance.repository.toLowerCase() !== repository.toLowerCase()) throw new Error("Section search snapshot unavailable or mismatched.");
    loaded.push(saved.document);
  }
  // Recompute explanations on validated canonical content; SQL never supplies authority or scores.
  const contexts = loaded.flatMap(projectSectionContexts);
  const matches = hits.map(hit => {
    const context = contexts.find(c => c.documentId === hit.documentId && c.sectionId === hit.sectionId);
    const match = context && matchSection(context, query);
    if (!match) throw new Error("Section search projection disagrees with the immutable snapshot.");
    return match;
  }).sort((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId) || a.sectionId.localeCompare(b.sectionId));
  const selection: CandidateSelection = candidateSelectionSchema.parse({ selectedDocumentIds: ids, matches, coverage: "search-selected", broadFallbackUsed: false, reason: "deterministic-matches" });
  const documents = loaded.map(document => ({ id: document.id, title: document.title,
    routes: document.context.filter(a => document.associations.includes(a.id) && a.kind === "route").map(a => a.value),
    sections: document.sections.map(section => ({ id: section.id, title: section.title, kind: section.kind,
      routes: document.context.filter(a => section.associations.includes(a.id) && a.kind === "route").map(a => a.value),
      associations: contexts.find(c => c.documentId === document.id && c.sectionId === section.id)!.associations.map(a => ({ kind: a.kind, value: a.value, origin: a.provenance.origin })),
      markdown: section.content.map(b => b.markdown),
    })),
  }));
  return { selection, documents };
}
