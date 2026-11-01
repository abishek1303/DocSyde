"use server";

import { revalidatePath } from "next/cache";
import { applyDocumentationReview } from "./apply-documentation-review";
import { reviewSelectionSchema, type ReviewOutcome } from "./documentation-review";
import { getDocumentationReviewPresentation } from "./review-proposal-operations";

const inputSchema = reviewSelectionSchema.omit({ publications: true });
/** Browser submits authority references and decisions only; materialization stays server-owned. */
export async function saveReviewedChanges(raw: unknown): Promise<ReviewOutcome> {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid-selection", proposalId: "", reason: "Choose a valid review decision for every change." };
  try {
    const input = parsed.data;
    // This read validates repository access and retained authority, also checked by apply.
    const review = await getDocumentationReviewPresentation(input.proposalId);
    if (review.status !== "found") return { status: "missing", proposalId: input.proposalId };
    const ids = new Set(input.decisions.map(d => d.decisionId));
    if (ids.size !== review.proposal.results.length || input.decisions.length !== ids.size || review.proposal.results.some(r => !ids.has(r.decisionId))) return { status: "invalid-selection", proposalId: input.proposalId, reason: "Review every change before saving." };
    const result = await applyDocumentationReview({ ...input, publications: [] });
    revalidatePath(`/documentation/proposals/${input.proposalId}`);
    revalidatePath("/docs");
    revalidatePath("/documentation/drafts");
    return result;
  } catch {
    return { status: "database-failure", proposalId: parsed.data.proposalId, reason: "Review unavailable. Reload to inspect saved receipts before retrying." };
  }
}
