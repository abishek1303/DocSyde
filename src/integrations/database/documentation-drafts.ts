import "server-only";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { getDatabase, type DatabaseExecutor } from "./client";
import { documentationDrafts, documentationPublications } from "./schema";

export async function insertDocumentationDraft(id: string, document: unknown, database: DatabaseExecutor = getDatabase()) {
  const [inserted] = await database.insert(documentationDrafts).values({ id, document })
    .onConflictDoNothing({ target: documentationDrafts.id }).returning();
  if (inserted) return { row: inserted, equal: true, inserted: true };
  // JSONB equality deliberately ignores object key order. Never UPDATE a draft.
  const [existing] = await database.select({
    id: documentationDrafts.id,
    document: documentationDrafts.document,
    savedAt: documentationDrafts.savedAt,
    equal: sql<boolean>`${documentationDrafts.document} = ${JSON.stringify(document)}::jsonb`,
  }).from(documentationDrafts).where(eq(documentationDrafts.id, id)).limit(1);
  if (!existing) throw new Error("Draft insert returned no record.");
  return { row: existing, equal: existing.equal, inserted: false };
}

export async function findDocumentationDraft(id: string, repository?: string, database: DatabaseExecutor = getDatabase()) {
  const [row] = await database.select().from(documentationDrafts)
    .where(and(eq(documentationDrafts.id, id), repository ? sql`lower(${documentationDrafts.document}->'provenance'->>'repository') = ${repository.toLowerCase()}` : undefined)).limit(1);
  return row ?? null;
}

export async function selectDocumentationDrafts(limit: number, before?: { savedAt: Date; id: string }, repository?: string, publishedOnly = false) {
  return getDatabase().select().from(documentationDrafts).where(and(publishedOnly ? sql`EXISTS (SELECT 1 FROM ${documentationPublications} p WHERE p.draft_id = ${documentationDrafts.id} AND p.repository = ${repository?.toLowerCase()})` : undefined,repository ? sql`lower(${documentationDrafts.document}->'provenance'->>'repository') = ${repository.toLowerCase()}` : undefined, before ? or(
    lt(documentationDrafts.savedAt, before.savedAt),
    and(eq(documentationDrafts.savedAt, before.savedAt), lt(documentationDrafts.id, before.id)),
  ) : undefined)).orderBy(desc(documentationDrafts.savedAt), desc(documentationDrafts.id)).limit(limit);
}

/** Derived search projection over immutable snapshots. Publication/current state
 * does not change snapshot identity or relevance. Latest Changes can restrict the
 * corpus to current publications; isolated Full Scan does not query this corpus. Only bounded hit IDs leave SQL. */
export async function searchDocumentationSections(repository: string, query: {
  tokens: string[]; associations: { kind: string; value: string }[]; sourcePaths?: string[]; priorTexts?: string[];
}, limit: number, publishedOnly = false): Promise<unknown[]> {
  const result = await getDatabase().execute(sql`
    WITH input AS (SELECT ${JSON.stringify(query)}::jsonb AS q), sections AS (
      SELECT d.id, d.document, s.section, input.q
      FROM ${documentationDrafts} d CROSS JOIN input
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.document->'sections') = 'array' THEN d.document->'sections' ELSE '[]'::jsonb END) AS s(section)
      WHERE lower(d.document->'provenance'->>'repository') = ${repository.toLowerCase()}
      ${publishedOnly ? sql`AND EXISTS (SELECT 1 FROM ${documentationPublications} p WHERE p.draft_id = d.id AND p.repository = ${repository.toLowerCase()})` : sql``}
    ), signals AS (
      SELECT id, section->>'id' AS section_id,
        ARRAY(SELECT t.value FROM jsonb_array_elements_text(q->'tokens') t(value)
          WHERE t.value = ANY(regexp_split_to_array(lower(document->>'title'), '[^a-z0-9]+'))) AS document_words,
        ARRAY(SELECT t.value FROM jsonb_array_elements_text(q->'tokens') t(value)
          WHERE t.value = ANY(regexp_split_to_array(lower(section->>'title'), '[^a-z0-9]+'))) AS section_words,
        ARRAY(SELECT t.value FROM jsonb_array_elements_text(q->'tokens') t(value)
          WHERE t.value = ANY(regexp_split_to_array(lower((SELECT string_agg(b.block->>'markdown', E'\n') FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(section->'content') = 'array' THEN section->'content' ELSE '[]'::jsonb END) b(block))), '[^a-z0-9]+'))) AS body_words,
        EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(document->'provenance'->'findings') = 'array' THEN document->'provenance'->'findings' ELSE '[]'::jsonb END) f(finding)
          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(f.finding->'citations') = 'array' THEN f.finding->'citations' ELSE '[]'::jsonb END) c(citation)
          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(document->'provenance'->'evidence') = 'array' THEN document->'provenance'->'evidence' ELSE '[]'::jsonb END) e(evidence)
          WHERE section->'findingRefs' @> jsonb_build_array(f.finding->>'id') AND c.citation->>'evidenceId' = e.evidence->>'id'
          AND (f.finding->>'contextId' IS NULL OR f.finding->>'contextId' = e.evidence->>'contextId')
          AND e.evidence->>'path' IN (SELECT jsonb_array_elements_text(coalesce(q->'sourcePaths', '[]'::jsonb)))) AS source_match,
        EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(q->'priorTexts', '[]'::jsonb)) p(value)
          WHERE strpos(lower((SELECT string_agg(b.block->>'markdown', E'\n') FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(section->'content') = 'array' THEN section->'content' ELSE '[]'::jsonb END) b(block))), lower(p.value)) > 0) AS prior_match,
        EXISTS(SELECT 1 FROM jsonb_array_elements(q->'associations') a(association)
          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(document->'context') = 'array' THEN document->'context' ELSE '[]'::jsonb END) c(context)
          WHERE a.association->>'kind' = c.context->>'kind' AND a.association->>'value' = c.context->>'value'
          AND (document->'associations' @> jsonb_build_array(c.context->>'id') OR section->'associations' @> jsonb_build_array(c.context->>'id'))) AS association_match
      FROM sections
    )
    SELECT id AS "documentId", section_id AS "sectionId" FROM signals
    WHERE source_match OR prior_match OR association_match OR (SELECT count(DISTINCT word) FROM unnest(document_words || section_words) AS words(word)) >= 2 OR cardinality(body_words) >= 3
    ORDER BY source_match DESC, prior_match DESC, association_match DESC,
      (cardinality(section_words) * 3 + cardinality(document_words) * 2 + cardinality(body_words)) DESC, id, section_id LIMIT ${limit}
  `);
  return result.rows;
}
