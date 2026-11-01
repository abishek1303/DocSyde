import type { AnalysisRejection } from "@/features/sources/product-analysis";
import { z } from "zod";
const ref = z.string().min(1).max(100);
export const associationChoice = z.object({ id: ref, kind: z.enum(["route", "feature", "workflow", "ui-surface", "audience"]), value: z.string().min(1).max(300), origin: z.enum(["operator", "finding"]), findingRef: ref.optional() }).strict();
export const qualifications = z.object({ support: z.enum(["directly-supported", "inferred"]), confidence: z.enum(["low", "medium", "high"]), confidenceReason: z.string(), assumptions: z.array(z.string()), uncertainties: z.array(z.string()) }).strict();
export const fact = z.object({ id: ref, findingRef: ref, field: z.enum(["description", "before", "after"]), value: z.string().min(1), qualifications }).strict();
export const draftProposal = z.object({ title: z.string().min(1).max(160), associations: z.array(ref).max(20), sections: z.array(z.object({
  title: z.string().min(1).max(160), kind: z.enum(["overview", "behavior", "requirements", "workflow", "limitations"]), associations: z.array(ref).max(20),
  content: z.array(z.object({ markdown: z.string().min(1).max(1500), factRefs: z.array(ref).min(1).max(6) }).strict()).min(1).max(2),
}).strict()).min(1).max(4) }).strict();
const citation = z.object({ evidenceId: ref, startLine: z.number().int().min(1), endLine: z.number().int().min(1), excerpt: z.string() }).strict();
export const provenanceFinding = z.object({ id: ref, kind: z.string(), description: z.string(), before: z.string().nullable(), after: z.string().nullable(), qualifications, citations: z.array(citation) }).strict();
export const provenance = z.object({ analysisId: z.uuid(), repository: z.string().url(), base: z.string().regex(/^[a-f0-9]{40}$/i), head: z.string().regex(/^[a-f0-9]{40}$/i), assessment: z.string(), limited: z.boolean(), limitations: z.array(z.string()), facts: z.array(fact), findings: z.array(provenanceFinding), evidence: z.array(z.object({ id: ref, path: z.string(), side: z.enum(["patch", "base", "head"]), commitId: z.string().nullable(), contentId: z.string().nullable() }).strict()) }).strict();
export const documentV1Schema = z.object({ id: z.uuid(), schemaVersion: z.literal(1), status: z.literal("draft"), title: draftProposal.shape.title, associations: z.array(ref),
  sections: z.array(draftProposal.shape.sections.element.extend({ id: z.uuid(), findingRefs: z.array(ref), qualifications: z.array(z.object({ findingRef: ref, ...qualifications.shape }).strict()) }).strict()),
  context: z.array(associationChoice), provenance, generation: z.object({ model: z.string(), createdAt: z.string().datetime(), repositoryContextUsed: z.string().max(500).nullable().optional(), runContextUsed: z.string().max(300).nullable().optional() }).strict(),
}).strict();
export const V2_MAX_CONTEXTS = 8;
export const V2_MAX_FACTS = 48;
export const V2_MAX_FINDINGS = 16;
export const V2_MAX_EVIDENCE = 64;
export const V2_MAX_ASSOCIATIONS = 52;
export const evidenceContextSchema = provenance.pick({ base: true, head: true, assessment: true, limited: true, limitations: true })
  .extend({ id: z.uuid() }).strict();
export const snapshotIdentitySchema = z.object({ documentId: z.uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const documentV2Schema = documentV1Schema.extend({
  schemaVersion: z.literal(2),
  provenance: z.object({
    repository: provenance.shape.repository, limitations: provenance.shape.limitations,
    // Aggregate coverage only; individual comparisons live in contexts.
    limited: z.boolean(), contexts: z.array(evidenceContextSchema).min(1).max(V2_MAX_CONTEXTS),
    facts: z.array(fact).max(V2_MAX_FACTS),
    findings: z.array(provenanceFinding.extend({ contextId: z.uuid() }).strict()).max(V2_MAX_FINDINGS),
    evidence: z.array(provenance.shape.evidence.element.extend({ contextId: z.uuid() }).strict()).max(V2_MAX_EVIDENCE),
    revision: z.object({ contextId: z.uuid(), basedOn: snapshotIdentitySchema.nullable(),
      planSha256: z.string().regex(/^[a-f0-9]{64}$/), decisionIds: z.array(z.string().regex(/^decision-[1-8]$/)).min(1).max(8),
    }).strict(),
  }).strict(),
  context: z.array(associationChoice).max(V2_MAX_ASSOCIATIONS),
}).strict();
export const documentSchema = z.discriminatedUnion("schemaVersion", [documentV1Schema, documentV2Schema]);
export type DocumentationDocument = z.infer<typeof documentSchema>;
export type DocumentationDocumentV1 = z.infer<typeof documentV1Schema>;
export type DocumentationDocumentV2 = z.infer<typeof documentV2Schema>;
export type DraftProposal = z.infer<typeof draftProposal>;
export type AssociationChoice = z.infer<typeof associationChoice>;
import type { GenerationContextSnapshot } from "@/features/sources/context/generation-context";
export type DraftFacts = { generationSnapshot?: GenerationContextSnapshot; facts: z.infer<typeof fact>[]; context: AssociationChoice[]; provenance: z.infer<typeof provenance> };
export type DraftResult = { status: "draft" | "no-draft" | "insufficient-evidence" | "error"; document: DocumentationDocument | null; reason?: string; analysisRejection?: AnalysisRejection; input?: DraftFacts; preview?: { serialized: string; signature: string }; saveUnavailable?: string };
