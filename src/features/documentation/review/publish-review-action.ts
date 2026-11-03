"use server";
import { revalidatePath } from "next/cache";
import { publishReviewedChanges, type ReviewPublicationOutcome } from "./publish-reviewed-changes";

export async function publishReviewChanges(raw: unknown): Promise<ReviewPublicationOutcome> {
  try {
    const result = await publishReviewedChanges(raw);
    // A conflict may follow a successful earlier target; refresh authoritative views too.
    revalidatePath("/docs");
    revalidatePath("/documentation/proposals/[id]", "page");
    revalidatePath("/documentation/drafts/[id]", "page");
    return result;
  } catch { return { status: "unavailable" }; }
}
