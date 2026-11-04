import { z } from "zod";
export const knowledgeTools = [
  { name: "get_product_context", title: "Product context", description: "DocSyde serves one configured project. Ask product questions directly; omit project identifiers. An omitted query returns an overview; a question searches published documentation with advisory repository orientation." },
  { name: "get_documentation", title: "Documentation", description: "Search published documentation for the single configured project using a natural-language query, or retrieve an exact route. No project identifier is needed." },
  { name: "get_context_for_surface", title: "Surface context", description: "Ask about a surface of the single configured project using a query or exact route, with advisory product orientation. No project identifier is needed." },
] as const;
export const knowledgeToolName = z.enum(["get_product_context", "get_documentation", "get_context_for_surface"]);
export type KnowledgeToolName = z.infer<typeof knowledgeToolName>;
export const projectInput = z.object({ query: z.string().trim().min(1).max(1000).optional().describe("A product question or documentation search. Omit for a project overview."), repository: z.string().max(250).optional().describe("Legacy search text; never selects a project. Omit this field.") }).strict();
export const surfaceInput = projectInput.extend({ route: z.string().min(1).max(300).regex(/^\/(?!\/)[^?#\s]*$/).optional().describe("Optional exact published product route; use query for natural-language questions.") }).strict();
const text = z.string().max(500);
export const knowledgeResultSchema = z.object({
  status: z.enum(["available", "no-live-documentation", "not-found", "unavailable", "invalid-request"]),
  message: text, repository: z.string().max(250), authority: z.literal("current-live-publications"),
  documents: z.array(z.object({ documentId: z.uuid(), title: z.string().max(160), route: z.string().max(300),
    version: z.object({ publishedAt: z.iso.datetime(), sourceRevision: z.string().regex(/^[a-f0-9]{40}$/i).nullable() }).strict(),
    sections: z.array(z.object({ title: z.string().max(160), blocks: z.array(z.string().max(1500)).max(2), images: z.array(z.object({ id: z.uuid(), url: z.string().max(800).regex(/^\/api\/documentation\/images\//), alt: z.string().max(240), caption: z.string().max(300).optional(), width: z.number().int().positive().max(8192), height: z.number().int().positive().max(8192) }).strict()).max(3).optional() }).strict()).max(4),
    limitations: z.array(text).max(6),
  }).strict()).max(5),
  orientation: z.object({ authority: z.literal("advisory-repository-understanding"), revision: z.string().max(40), asOf: z.iso.datetime(),
    purpose: z.string().max(400), audience: z.string().max(400), terminology: z.array(z.string().max(400)).max(8), gaps: z.array(z.string().max(400)).max(8),
  }).strict().nullable(),
  moreDocuments: z.boolean(), notes: z.array(text).max(8),
}).strict();
export type KnowledgeResult = z.infer<typeof knowledgeResultSchema>;
export const KNOWLEDGE_MAX_BYTES = 64 * 1024;
export function emptyKnowledge(status: KnowledgeResult["status"], message: string, repository = ""): KnowledgeResult {
  return { status, message, repository, authority: "current-live-publications", documents: [], orientation: null, moreDocuments: false,
    notes: ["Only live publications establish current product behavior. Pending proposals and unpublished saves are excluded."] };
}
