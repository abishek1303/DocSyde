import { z } from "zod";
export const knowledgeTools = [
  { name: "get_product_context", title: "Product context", description: "Understand the product from current live documentation, with separately labeled repository orientation." },
  { name: "get_documentation", title: "Documentation", description: "Retrieve current published documentation for an exact product route." },
  { name: "get_context_for_surface", title: "Surface context", description: "Get current documentation and advisory product orientation for an exact product route." },
] as const;
export const knowledgeToolName = z.enum(["get_product_context", "get_documentation", "get_context_for_surface"]);
export type KnowledgeToolName = z.infer<typeof knowledgeToolName>;
export const projectInput = z.object({ repository: z.string().min(3).max(250) }).strict();
export const surfaceInput = projectInput.extend({ route: z.string().min(1).max(300).regex(/^\/(?!\/)[^?#\s]*$/) }).strict();
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
