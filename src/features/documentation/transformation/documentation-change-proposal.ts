import { z } from "zod";
import { documentSchema, documentV2Schema, draftProposal, snapshotIdentitySchema, fact, associationChoice } from "../documents/document";
import { documentationImpactPlanSchema } from "../planning/documentation-impact";
import { productImpactSchema } from "@/features/sources/product-evidence";

export const TRANSFORMATION_REQUEST_BYTES = 32 * 1024;
export const TRANSFORMATION_AGGREGATE_BYTES = 128 * 1024;
export const TRANSFORMATION_OUTPUT_TOKENS = 8192;
// Conservative output-capacity units: a full new document consumes eight blocks.
export const TRANSFORMATION_BATCH_BLOCKS = 12;
export const SUPPORT_REQUEST_BYTES = 32 * 1024;
export const decisionIdSchema = z.string().regex(/^decision-[1-8]$/);
const claimRef = z.string().regex(/^claim-[1-6]$/);
export const authoredSectionSchema = draftProposal.shape.sections.element.extend({
  content: z.array(draftProposal.shape.sections.element.shape.content.element.extend({
    claimRefs: z.array(claimRef).min(1).max(6),
    markdown: z.string().min(1).max(800),
  }).strict()).min(1).max(2),
}).strict();
const placementSchema = z.object({ position: z.enum(["before", "after", "undetermined"]), sectionId: z.uuid().nullable(), reason: z.string().min(1).max(300) }).strict();
const completeDocument = { title: draftProposal.shape.title, associations: draftProposal.shape.associations };
export const transformationChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("replace-section"), section: authoredSectionSchema }).strict(),
  z.object({ kind: z.literal("add-section"), section: authoredSectionSchema, placement: placementSchema }).strict(),
  z.object({ kind: z.literal("add-document"), ...completeDocument, sections: z.array(authoredSectionSchema).min(1).max(4) }).strict(),
  z.object({ kind: z.literal("replace-document"), ...completeDocument, sections: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("retain"), sectionId: z.uuid() }).strict(),
    z.object({ kind: z.literal("write"), sectionId: z.uuid().nullable(), section: authoredSectionSchema }).strict(),
  ])).min(1).max(4) }).strict(),
  z.object({ kind: z.literal("incomplete"), reason: z.string().min(1).max(500) }).strict(),
]);
export const transformationEntrySchema = z.object({
  decisionId: decisionIdSchema,
  target: z.object({ documentId: z.uuid().nullable(), sectionId: z.uuid().nullable(), snapshotSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict(),
  change: transformationChangeSchema,
}).strict();
// The outer capability validates bounded JSON; each unknown entry is strictly
// validated independently, so one malformed decision cannot erase valid siblings.
export const transformationEnvelopeSchema = z.object({ entries: z.array(z.unknown()).max(8) }).strict();
export const modelMetadataSchema = z.object({ model: z.string().min(1).max(300), elapsedMs: z.number().finite().nonnegative() }).strict();
export const transformationAuthorizationSchema = z.object({
  decisionId: decisionIdSchema, decision: documentationImpactPlanSchema.shape.decisions.element,
  target: transformationEntrySchema.shape.target,
  shape: z.enum(["replace-section", "replace-document", "add-section", "add-document"]),
  claims: z.array(z.object({ id: claimRef, claim: productImpactSchema.shape.claims.element }).strict()).min(1).max(6),
  facts: z.array(fact.extend({ claimRefs: z.array(claimRef).min(1).max(6) }).strict()).min(1).max(12),
  evidenceRefs: z.array(z.string().min(1).max(100)).max(16),
  associations: z.array(associationChoice).max(40), limitations: z.array(z.string()).max(100),
}).strict();
export type TransformationAuthorization = z.infer<typeof transformationAuthorizationSchema>;
export const decisionResultSchema = z.object({
  decisionId: decisionIdSchema, decision: documentationImpactPlanSchema.shape.decisions.element,
  generation: z.enum(["not-required", "pending", "generated", "incomplete", "failed"]),
  support: z.enum(["not-required", "pending", "supported", "unsupported", "uncertain", "failed"]),
  reviewReady: z.boolean(), materialization: z.enum(["not-applicable", "pending", "ready", "blocked"]),
  // No approval/signature is produced. A valid candidate is save-compatible only.
  approval: z.literal("not-requested"), saveCompatible: z.boolean(),
  issues: z.array(z.string().min(1).max(500)).max(20),
  limitations: z.array(z.string()).max(100),
  compositionModel: modelMetadataSchema.optional(),
  change: transformationChangeSchema.nullable(), model: modelMetadataSchema.nullable(),
  candidateId: z.uuid().nullable(),
}).strict();
export const documentationChangeProposalSchema = z.object({
  proposalId: z.uuid(), createdAt: z.iso.datetime(), impactSha256: z.string().regex(/^[a-f0-9]{64}$/), planSha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["complete", "partial", "failed"]),
  impact: productImpactSchema, plan: documentationImpactPlanSchema,
  targets: z.array(z.object({ identity: snapshotIdentitySchema, document: documentSchema }).strict()).max(8),
  authorizations: z.array(transformationAuthorizationSchema).max(8),
  results: z.array(decisionResultSchema).max(8),
  candidates: z.array(z.object({ decisionIds: z.array(decisionIdSchema).min(1).max(8), document: documentV2Schema }).strict()).max(8),
  batches: z.array(z.object({ decisionIds: z.array(decisionIdSchema).min(1).max(8), requestBytes: z.number().int().positive(),
    status: z.enum(["completed", "failed", "not-attempted"]), model: modelMetadataSchema.nullable() }).strict()).max(8),
  supportModel: modelMetadataSchema.nullable(), supportAttempted: z.boolean(), protocolIssues: z.array(z.string().max(500)).max(20),
  supportChecks: z.array(z.object({ unitId: z.string().min(1).max(100), decisionId: decisionIdSchema,
    verdict: z.enum(["supported", "unsupported", "uncertain"]), reason: z.string().min(1).max(300) }).strict()).max(128),
}).strict();
export type DocumentationChangeProposal = z.infer<typeof documentationChangeProposalSchema>;
export type DecisionResult = z.infer<typeof decisionResultSchema>;
export type TransformationChange = z.infer<typeof transformationChangeSchema>;
export type AuthoredSection = z.infer<typeof authoredSectionSchema>;
