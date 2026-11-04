import "server-only";
import { selectedRepository } from "@/features/sources/run-preparation";
import { getUnderstanding } from "@/features/sources/product-knowledge";
import { documentationHub, currentPublishedDocumentation, documentSourceHead } from "../library/library-operations";
import { deliveredImage } from "../images/document-image";
import { textTokens, matchSection, QUERY_TOKEN_LIMIT } from "../planning/candidate-selection";
import { documentationHash } from "../documents/document-identity";
import type { DocumentationDocument } from "../documents/document";
import { emptyKnowledge, knowledgeToolName, knowledgeResultSchema, projectInput, surfaceInput, KNOWLEDGE_MAX_BYTES, type KnowledgeResult } from "./knowledge-contract";

function sectionScore(document: DocumentationDocument, section: DocumentationDocument["sections"][number], tokens: string[]): number {
  if (!tokens.length) return 0;
  const context = { documentId: document.id, documentSha256: documentationHash(document), sectionId: section.id,
    documentTitle: document.title, title: section.title, purpose: section.kind,
    text: section.content.map(block => block.markdown).join("\n"), associations: [] };
  const match = matchSection(context, { tokens, associations: [] });
  if (match) return match.score;
  const words = new Set(textTokens(`${context.documentTitle} ${context.title} ${context.text}`));
  return tokens.filter(token => words.has(token)).length;
}

function published(document: DocumentationDocument, route: string, publishedAt: string, tokens: string[]): KnowledgeResult["documents"][number] {
  return { documentId: document.id, title: document.title, route, version: { publishedAt, sourceRevision: documentSourceHead(document) },
    sections: document.sections.map((section, index) => ({ section, index, score: sectionScore(document, section, tokens) }))
      .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 4).map(({ section }) => ({ title: section.title, blocks: section.content.map((block, index) => {
      const words = new Set(textTokens(block.markdown));
      return { block, index, score: tokens.filter(token => words.has(token)).length };
    }).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 2).map(({ block }) => block.markdown.slice(0, 1500)), ...(section.images?.length ? { images: section.images.slice(0, 3).map(image => deliveredImage(image, document.id, document.provenance.repository)) } : {}) })),
    limitations: [...(document.sections.length > 4 || document.sections.some(section => section.content.length > 2 || section.content.some(block => block.markdown.length > 1500) || (section.images?.length ?? 0) > 3) ? ["This document excerpt is truncated to MCP response limits."] : []), ...new Set(document.provenance.limitations)].slice(0, 6).map(value => value.slice(0, 500)) };
}
/** Shared application query for MCP and its UI. No inference, pending artifacts, indexing, or mutations. */
export async function queryProductKnowledge(operation: unknown, raw: unknown): Promise<KnowledgeResult> {
  const name = knowledgeToolName.safeParse(operation);
  if (!name.success) return emptyKnowledge("invalid-request", "Choose one of the available product-context capabilities.");
  const input = (name.data === "get_product_context" ? projectInput : surfaceInput).safeParse(raw);
  if (!input.success) return emptyKnowledge("invalid-request", "Provide an optional question, documentation search, or exact product route.");
  let repository;
  try { repository = selectedRepository({}); }
  catch { return emptyKnowledge("unavailable", "DocSyde has no valid configured project."); }
  try {
    const result = emptyKnowledge("available", "Current published product knowledge.", repository.name);
    const route = name.data === "get_product_context" ? undefined : surfaceInput.parse(input.data).route;
    // Legacy repository arguments are search intent, never a scope override.
    const query = input.data.query ?? (input.data.repository === repository.name ? undefined : input.data.repository);
    const questionWords = new Set(["what", "does", "application", "how", "would", "about", "please", "could", "tell", "explain"]);
    const search = { tokens: textTokens(query ?? "").filter(token => !questionWords.has(token)).slice(0, QUERY_TOKEN_LIMIT), associations: [] };
    let hasPublished = false;
    if (route) {
      const live = await currentPublishedDocumentation(repository, route);
      if (live) { hasPublished = true; result.documents = [published(live.document, live.route, live.publishedAt, search.tokens)]; }
    }
    if (!route || !result.documents.length) {
      const matches: { document: KnowledgeResult["documents"][number]; score: number }[] = [];
      let page = 1;
      do {
        const live = await documentationHub({ ...repository, page }, "live");
        if (live.kind !== "live") throw new Error("Unexpected library view.");
        hasPublished ||= live.entries.length > 0;
        if (!route) for (const entry of live.entries) {
          // Rank and excerpt the same published sections; historical evidence
          // links never authorize or suppress live published text.
          const score = search.tokens.length ? Math.max(0, ...entry.document.sections.map(section => sectionScore(entry.document, section, search.tokens))) : 1;
          if (score) matches.push({ document: published(entry.document, entry.route, entry.publishedAt, search.tokens), score });
        }
        matches.sort((a, b) => b.score - a.score);
        if (matches.length > 5) { result.moreDocuments = true; matches.length = 5; }
        if (!live.hasMore || route || !search.tokens.length) { if (!route && !search.tokens.length) result.moreDocuments ||= live.hasMore; break; }
        page++;
      } while (page <= 10000);
      if (!route) result.documents = matches.map(match => match.document);
    }
    if (name.data !== "get_documentation") {
      try {
        const understanding = await getUnderstanding(repository.name);
        if (understanding) result.orientation = { authority: "advisory-repository-understanding", revision: understanding.sha, asOf: understanding.analyzedAt,
          purpose: understanding.summary.purpose, audience: understanding.summary.audience, terminology: understanding.summary.terminology, gaps: understanding.summary.gaps };
      } catch { result.notes.push("Repository orientation is unavailable; published documentation remains authoritative."); }
      result.notes.push("Repository orientation is advisory and may lag live documentation. It does not establish current product behavior.");
    }
    if (!result.documents.length) { result.status = hasPublished ? "not-found" : "no-live-documentation"; result.message = hasPublished ? "No matching published documentation was found for this question or route." : "No approved documentation has been published for this project yet."; }
    while (result.documents.length > 1 && Buffer.byteLength(JSON.stringify(result)) > KNOWLEDGE_MAX_BYTES - 1000) { result.documents.pop(); result.moreDocuments = true; }
    if (result.moreDocuments) result.notes.push("This overview is bounded. Ask a more specific question or retrieve an exact product route for more documentation.");
    const validated = knowledgeResultSchema.parse(result);
    if (Buffer.byteLength(JSON.stringify(validated)) > KNOWLEDGE_MAX_BYTES) return emptyKnowledge("unavailable", "This document exceeds the context response limit.", repository.name);
    return validated;
  } catch { return emptyKnowledge("unavailable", "Product knowledge is temporarily unavailable. Please try again later.", repository.name); }
}
