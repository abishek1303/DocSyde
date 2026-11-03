import { z } from "zod";
const text = z.string().min(1).max(400);
export const understandingSummary = z.object({ purpose: text, audience: text, terminology: z.array(text).max(8), workflows: z.array(text).max(8), surfaces: z.array(text).max(8), gaps: z.array(text).max(8) }).strict();
// New model output is compact; persisted historical artifacts retain their existing read contract.
export const compactUnderstandingSummary = z.object({
 purpose: z.string().min(1).max(240),
 audience: z.string().min(1).max(160),
 terminology: z.array(z.string().min(1).max(90)).max(8),
 workflows: z.array(z.string().min(1).max(160)).max(6),
 surfaces: z.array(z.string().min(1).max(120)).max(8),
 gaps: z.array(z.string().min(1).max(160)).max(3),
}).strict();
export const repositoryUnderstanding = z.object({ schemaVersion: z.literal(1), repository: z.string().max(512), sha: z.string().regex(/^[a-f0-9]{40}$/i), analyzedAt: z.iso.datetime(), summary: understandingSummary, generationContext: z.object({ productContextUsed: z.string().max(500).nullable() }).strict().optional(), files: z.array(z.object({ path: z.string().max(1024), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(6) }).strict();
export type RepositoryUnderstanding = z.infer<typeof repositoryUnderstanding>;
