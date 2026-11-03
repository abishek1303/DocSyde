import { z } from "zod";
import { decisionIdSchema } from "../transformation/documentation-change-proposal";

export const REVIEW_INITIAL_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const REVIEW_PROPOSAL_MAX_BYTES = 2 * 1024 * 1024;
export const REVIEW_MAX_PUBLICATION_TARGETS = 64;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const reviewSelectionSchema = z.object({
  proposalId: z.uuid(), expectedProposalHash: hash,
  decisions: z.array(z.object({ decisionId: decisionIdSchema, choice: z.enum(["approve", "reject", "acknowledge"]) }).strict()).max(8),
  publications: z.array(z.discriminatedUnion("intent", [
    z.object({ targetId: z.uuid(), intent: z.literal("replace"), observedPublicationId: z.uuid() }).strict(),
    z.object({ targetId: z.uuid(), intent: z.literal("publish") }).strict(),
  ])).max(REVIEW_MAX_PUBLICATION_TARGETS),
  note: z.string().max(1000).optional(),
}).strict();
export const publicationDescriptorSchema = z.object({
  id: z.uuid(), unitId: z.string().min(1).max(100), route: z.string().min(1).max(300),
  baselineId: z.uuid().nullable(), observedId: z.uuid().nullable(), associationIds: z.array(z.string().max(100)).max(52),
}).strict();
export const saveReceiptSchema = z.object({
  unitId: z.string().min(1).max(100), decisionIds: z.array(decisionIdSchema).min(1).max(8),
  baseline: z.enum(["not-required", "exact", "missing", "mismatched"]),
  materialization: z.enum(["ready", "blocked"]),
  status: z.enum(["saved", "conflict", "blocked"]), documentId: z.uuid().nullable(), sha256: hash.nullable(),
  equalSave: z.boolean().nullable(), savedAt: z.iso.datetime().nullable(), reason: z.string().max(500).nullable(), at: z.iso.datetime(),
}).strict();
export const publicationReceiptSchema = z.object({
  targetId: z.uuid(), intent: z.enum(["replace", "publish"]),
  status: z.enum(["published", "conflict", "blocked"]), expectedId: z.uuid().nullable(),
  actualId: z.uuid().nullable(), actualDocumentId: z.uuid().nullable(),
  // Optional on historical receipts. A consolidated publish may select a subset of an already approved unit.
  decisionIds: z.array(decisionIdSchema).min(1).max(8).optional(),
  excludedDecisionIds: z.array(decisionIdSchema).max(8).optional(), at: z.iso.datetime(), reason: z.string().max(500).nullable(),
}).strict();
export const acceptedReviewSchema = z.object({
  operationId: z.uuid(), selectionHash: hash, selection: reviewSelectionSchema, acceptedAt: z.iso.datetime(),
  exclusions: z.array(z.object({ decisionId: decisionIdSchema, at: z.iso.datetime() }).strict()).max(8).optional(),
  saves: z.array(saveReceiptSchema).max(8), publications: z.array(publicationReceiptSchema).max(REVIEW_MAX_PUBLICATION_TARGETS),
}).strict();
export type ReviewSelection = z.infer<typeof reviewSelectionSchema>;
export type PublicationDescriptor = z.infer<typeof publicationDescriptorSchema>;
export type AcceptedReview = z.infer<typeof acceptedReviewSchema>;
export type SaveReceipt = z.infer<typeof saveReceiptSchema>;
export type PublicationReceipt = z.infer<typeof publicationReceiptSchema>;
export type ReviewOutcome = {
  status: "complete" | "partial" | "unfinished" | "cancelled" | "missing" | "expired" | "hash-mismatch" | "invalid-selection" | "selection-conflict" | "repository-mismatch" | "database-failure";
  proposalId: string; proposalHash?: string; hashStatus?: "matches" | "mismatched"; review?: AcceptedReview;
  decisions?: { decisionId: string; action: string; disposition: "approve" | "reject" | "acknowledge" | "not-reviewed" }[];
  warnings?: string[]; reason?: string;
};
export function normalizeReviewSelection(raw: unknown): ReviewSelection {
  const input = reviewSelectionSchema.parse(raw);
  for (const ids of [input.decisions.map(item => item.decisionId), input.publications.map(item => item.targetId)]) {
    if (new Set(ids).size !== ids.length) throw new Error("Duplicate review choice.");
  }
  return { ...input, decisions: [...input.decisions].sort((a, b) => a.decisionId.localeCompare(b.decisionId)),
    publications: [...input.publications].sort((a, b) => a.targetId.localeCompare(b.targetId)) };
}
