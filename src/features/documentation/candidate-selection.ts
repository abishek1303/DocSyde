import { z } from "zod";
import { associationChoice } from "./document";
import type { ProductImpact } from "@/features/sources/product-analysis";
import type { SectionContext } from "./section-context";

export const CANDIDATE_DOCUMENT_LIMIT = 10;
export const CANDIDATE_SECTION_LIMIT = 40;
export const QUERY_TOKEN_LIMIT = 24;
export const candidateQuerySchema = z.object({
  tokens: z.array(z.string().regex(/^[a-z0-9]{3,40}$/)).max(QUERY_TOKEN_LIMIT),
  associations: z.array(associationChoice.pick({ kind: true, value: true })).max(20),
}).strict();
export type CandidateQuery = z.infer<typeof candidateQuerySchema>;
const tokens = z.array(z.string().regex(/^[a-z0-9]{3,40}$/)).min(1).max(QUERY_TOKEN_LIMIT);
const reason = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("association"), associationKind: associationChoice.shape.kind, value: associationChoice.shape.value, points: z.literal(40) }).strict(),
  z.object({ kind: z.literal("document-title"), tokens, points: z.number().int().min(2).max(48) }).strict(),
  z.object({ kind: z.literal("section-title"), tokens, points: z.number().int().min(3).max(72) }).strict(),
  z.object({ kind: z.literal("section-text"), tokens, points: z.number().int().min(1).max(24) }).strict(),
]);
export const candidateMatchSchema = z.object({
  documentId: z.uuid(), documentSha256: z.string().regex(/^[a-f0-9]{64}$/), sectionId: z.uuid(),
  score: z.number().int().min(1).max(944), reasons: z.array(reason).min(1).max(23),
}).strict();
export const candidateSelectionSchema = z.object({
  selectedDocumentIds: z.array(z.uuid()).max(CANDIDATE_DOCUMENT_LIMIT),
  matches: z.array(candidateMatchSchema).max(CANDIDATE_SECTION_LIMIT),
  coverage: z.enum(["complete", "search-selected", "incomplete"]), broadFallbackUsed: z.boolean(),
  reason: z.enum(["deterministic-matches", "no-useful-matches", "plausible-candidates-exceed-limit"]),
}).strict().superRefine((s, ctx) => {
  const ids = new Set(s.selectedDocumentIds), matches = new Set(s.matches.map(m => `${m.documentId}:${m.sectionId}`));
  if (ids.size !== s.selectedDocumentIds.length || matches.size !== s.matches.length || s.matches.some(m => !ids.has(m.documentId))
    || (s.coverage === "complete") !== s.broadFallbackUsed
    || (s.coverage === "complete" && (s.reason !== "no-useful-matches" || s.matches.length))
    || (s.coverage === "search-selected" && (s.reason !== "deterministic-matches" || !s.matches.length || s.selectedDocumentIds.some(id => !s.matches.some(m => m.documentId === id))))
    || (s.coverage === "incomplete" && (s.reason !== "plausible-candidates-exceed-limit" || s.matches.length || ids.size))) ctx.addIssue({ code: "custom", message: "Inconsistent candidate selection" });
  for (const m of s.matches) {
    if (s.matches.some(other => other.documentId === m.documentId && other.documentSha256 !== m.documentSha256)) ctx.addIssue({ code: "custom", message: "Conflicting snapshot hashes" });
    if (m.score !== m.reasons.reduce((sum, r) => sum + r.points, 0) || m.reasons.some(r => r.kind !== "association" && (new Set(r.tokens).size !== r.tokens.length || r.points !== r.tokens.length * (r.kind === "section-title" ? 3 : r.kind === "document-title" ? 2 : 1)))) ctx.addIssue({ code: "custom", message: "Invalid relevance explanation" });
  }
});
export type CandidateSelection = z.infer<typeof candidateSelectionSchema>;
export type CandidateMatch = z.infer<typeof candidateMatchSchema>;

const stopWords = new Set("the and for with from into this that these those has have had are was were will can may must not now new old before after change changes changed behavior source supplied evidence required optional requirement current documentation document section only existing user supported support true false".split(" "));
export function textTokens(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter(t => t.length >= 3 && t.length <= 40 && !stopWords.has(t)).sort();
}
export function candidateQuery(impact: ProductImpact, context: { kind: CandidateQuery["associations"][number]["kind"]; value: string }[] = []): CandidateQuery {
  const words = textTokens(impact.claims.map(c => [c.description, c.before, c.after].filter(Boolean).join(" ")).join(" "));
  const routes = [...(impact.provenance.runtimeInspection?.requestedTargets ?? []), ...impact.provenance.captures.flatMap(c => [c.requestedPathname, c.finalPathname])];
  const associations = [...context.map(({ kind, value }) => ({ kind, value })), ...routes.filter(value => value.length <= 300).map(value => ({ kind: "route" as const, value }))];
  const unique = [...new Map(associations.map(a => [`${a.kind}:${a.value}`, a])).values()];
  // Explicitly bounded query signals, never model ranking or corpus summarization.
  return candidateQuerySchema.parse({ tokens: words.slice(0, QUERY_TOKEN_LIMIT), associations: unique.slice(0, 20) });
}
export function matchSection(context: SectionContext, query: CandidateQuery): CandidateMatch | null {
  const overlap = (text: string) => { const words = new Set(textTokens(text)); return query.tokens.filter(t => words.has(t)); };
  const documentTitle = overlap(context.documentTitle), sectionTitle = overlap(context.title), body = overlap(context.text);
  const exact = query.associations.filter(a => context.associations.some(b => a.kind === b.kind && a.value === b.value));
  if (!exact.length && new Set([...documentTitle, ...sectionTitle]).size < 2 && body.length < 3) return null;
  const reasons: CandidateMatch["reasons"] = exact.map(a => ({ kind: "association", associationKind: a.kind, value: a.value, points: 40 }));
  if (documentTitle.length) reasons.push({ kind: "document-title", tokens: documentTitle, points: documentTitle.length * 2 });
  if (sectionTitle.length) reasons.push({ kind: "section-title", tokens: sectionTitle, points: sectionTitle.length * 3 });
  if (body.length) reasons.push({ kind: "section-text", tokens: body, points: body.length });
  return candidateMatchSchema.parse({ documentId: context.documentId, documentSha256: context.documentSha256, sectionId: context.sectionId, score: reasons.reduce((sum, r) => sum + r.points, 0), reasons });
}
