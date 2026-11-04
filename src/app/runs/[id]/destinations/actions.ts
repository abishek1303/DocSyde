"use server";
import { revalidatePath } from "next/cache";
import { confirmDocumentationDestination } from "@/features/documentation/review/destination-resolution";
import { readStoredDocumentationRun } from "@/features/documentation/runs/read-run-record";
export async function confirmDestination(_previous: { error?: string; message?: string }, form: FormData): Promise<{ error?: string; message?: string }> {
  try {
    if (form.get("confirmed") !== "on") return { error: "Confirm the screen where this documentation belongs." };
    const run = await readStoredDocumentationRun(form.get("runId"));
    if (!run || !("schemaVersion" in run.record) || !run.record.retainedProposal) throw new Error("Run unavailable");
    await confirmDocumentationDestination({ repository: `${run.record.input.owner}/${run.record.input.repo}`, proposalId: run.record.retainedProposal.proposalId,
      expectedHash: form.get("expectedHash"), targetId: form.get("targetId"), confirmed: true });
    revalidatePath(`/runs/${run.id}`); revalidatePath(`/runs/${run.id}/destinations`); revalidatePath("/docs"); revalidatePath("/runs/new");
    return { message: "Destination recorded. Review Pending Changes for publishable work; nothing has been published." };
  } catch { return { error: "The destination could not be confirmed. The proposal may have changed, expired, or another batch may need review first." }; }
}
