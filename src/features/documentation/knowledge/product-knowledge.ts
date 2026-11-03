import "server-only";
import { selectedRepository } from "@/features/sources/run-preparation";
import { getUnderstanding } from "@/features/sources/product-knowledge";
import { documentationHub, currentPublishedDocumentation, documentSourceHead } from "../library/library-operations";
import { deliveredImage } from "../images/document-image";
import type { DocumentationDocument } from "../documents/document";
import { emptyKnowledge, knowledgeToolName, knowledgeResultSchema, projectInput, surfaceInput, KNOWLEDGE_MAX_BYTES, type KnowledgeResult } from "./knowledge-contract";

function published(document: DocumentationDocument, route: string, publishedAt: string): KnowledgeResult["documents"][number] {
  return { documentId: document.id, title: document.title, route, version: { publishedAt, sourceRevision: documentSourceHead(document) },
    sections: document.sections.map(section => ({ title: section.title, blocks: section.content.map(block => block.markdown), ...(section.images?.length ? { images: section.images.map(image => deliveredImage(image, document.id, document.provenance.repository)) } : {}) })),
    limitations: [...new Set(document.provenance.limitations)].slice(0, 6).map(value => value.slice(0, 500)) };
}
/** Shared application query for MCP and its UI. No inference, pending artifacts, indexing, or mutations. */
export async function queryProductKnowledge(operation: unknown, raw: unknown): Promise<KnowledgeResult> {
  const name = knowledgeToolName.safeParse(operation);
  if (!name.success) return emptyKnowledge("invalid-request", "Choose one of the available product-context capabilities.");
  const input = (name.data === "get_product_context" ? projectInput : surfaceInput).safeParse(raw);
  if (!input.success) return emptyKnowledge("invalid-request", "Choose a project and, for documentation, an exact product route.");
  let repository;
  try { repository = selectedRepository({ repository: input.data.repository }); }
  catch { return emptyKnowledge("not-found", "This project is not available to DocSyde."); }
  try {
    const result = emptyKnowledge("available", "Current published product knowledge.", repository.name);
    if (name.data === "get_product_context") {
      const live = await documentationHub(repository, "live");
      if (live.kind !== "live") throw new Error("Unexpected library view.");
      result.documents = live.entries.slice(0, 5).map(entry => published(entry.document, entry.route, entry.publishedAt));
      result.moreDocuments = live.hasMore || live.entries.length > 5;
    } else {
      const { route } = surfaceInput.parse(input.data);
      const live = await currentPublishedDocumentation(repository, route);
      if (!live) return emptyKnowledge("not-found", "No live documentation is associated with this product route.", repository.name);
      result.documents = [published(live.document, live.route, live.publishedAt)];
    }
    if (name.data !== "get_documentation") {
      try {
        const understanding = await getUnderstanding(repository.name);
        if (understanding) result.orientation = { authority: "advisory-repository-understanding", revision: understanding.sha, asOf: understanding.analyzedAt,
          purpose: understanding.summary.purpose, audience: understanding.summary.audience, terminology: understanding.summary.terminology, gaps: understanding.summary.gaps };
      } catch { result.notes.push("Repository orientation is unavailable; published documentation remains authoritative."); }
      result.notes.push("Repository orientation is advisory and may lag live documentation. It does not establish current product behavior.");
    }
    if (!result.documents.length) { result.status = "no-live-documentation"; result.message = "No approved documentation has been published for this project yet."; }
    while (result.documents.length > 1 && Buffer.byteLength(JSON.stringify(result)) > KNOWLEDGE_MAX_BYTES - 1000) { result.documents.pop(); result.moreDocuments = true; }
    if (result.moreDocuments) result.notes.push("This overview is bounded. Retrieve an exact product route for its full current documentation.");
    const validated = knowledgeResultSchema.parse(result);
    if (Buffer.byteLength(JSON.stringify(validated)) > KNOWLEDGE_MAX_BYTES) return emptyKnowledge("unavailable", "This document exceeds the context response limit.", repository.name);
    return validated;
  } catch { return emptyKnowledge("unavailable", "Product knowledge is temporarily unavailable. Please try again later.", repository.name); }
}
