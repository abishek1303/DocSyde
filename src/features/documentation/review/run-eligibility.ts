import "server-only";
import type { DatabaseExecutor } from "@/integrations/database/client";
import { hasActionablePendingChanges } from "./pending-workspace";

export const PENDING_REVIEW_MESSAGE = "You have documentation changes waiting for review. Publish or discard them before starting another run.";
export class PendingReviewConflict extends Error {
  readonly code = "pending-review";
  constructor() { super(PENDING_REVIEW_MESSAGE); }
}
export async function assertRunReviewEligible(repository: string, database?: DatabaseExecutor) {
  if (await hasActionablePendingChanges(repository, database)) throw new PendingReviewConflict();
}
