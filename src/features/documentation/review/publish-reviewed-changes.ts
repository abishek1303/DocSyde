import "server-only";
import { z } from "zod";
import { getDocumentationReviewPresentation } from "./review-proposal-operations";
import { getPublication, publishDocumentation, savedDocumentCoordinates } from "../publication/publication-operations";

const input = z.object({ proposalId: z.uuid(), expectedProposalHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type ReviewPublicationOutcome = { status: "published" | "conflict" | "unavailable"; documentId?: string };
/** Explicit publication of server-owned saved receipts. Original observations protect live content from concurrent replacements. */
export async function publishReviewedChanges(raw: unknown): Promise<ReviewPublicationOutcome> {
  const parsed = input.parse(raw);
  const state = await getDocumentationReviewPresentation(parsed.proposalId);
  if (state.status !== "found" || state.proposalHash !== parsed.expectedProposalHash || !state.review) return { status: "unavailable" };
  const review = state.review;
  const approved = review.selection.decisions.filter(choice => choice.choice === "approve");
  if (!approved.length || approved.some(choice => !review.saves.some(save => save.status === "saved" && save.decisionIds.includes(choice.decisionId)))) return { status: "unavailable" };
  const coordinates = savedDocumentCoordinates(state.repository);
  const targets = state.targets.flatMap(target => {
    const save = review.saves.find(save => save.unitId === target.unitId && save.status === "saved" && save.documentId);
    return save?.documentId ? [{ target, documentId: save.documentId }] : [];
  });
  if (!targets.length) return { status: "unavailable" };
  // Preflight every target before publishing any of them; each write still uses CAS.
  const pending: typeof targets = [];
  for (const entry of targets) {
    const current = await getPublication({ ...coordinates, route: entry.target.route });
    if (current?.draftId === entry.documentId) continue;
    if ((current?.id ?? null) !== entry.target.observedId) return { status: "conflict" };
    pending.push(entry);
  }
  for (const { target, documentId } of pending) {
    const result = await publishDocumentation({ ...coordinates, route: target.route, draftId: documentId,
      ...(target.observedId ? { observedId: target.observedId } : {}) });
    if (result.status !== "published") return { status: "conflict" };
  }
  return { status: "published", documentId: targets[0].documentId };
}
