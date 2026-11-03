"use server";
import { revalidatePath } from "next/cache";
import { getPendingWorkspace, publishPendingWorkspace, discardPendingWorkspace, type PendingWorkspace } from "./pending-workspace";
export async function previewPendingChanges(raw: unknown): Promise<PendingWorkspace | null> {
  try { return await getPendingWorkspace(raw); } catch { return null; }
}
export async function publishPendingChanges(raw: unknown) {
  const result = await publishPendingWorkspace(raw);
  for (const path of ["/docs", "/mcp", "/documentation/drafts", "/documentation/proposals", "/runs/new"]) revalidatePath(path);
  return result;
}

export async function discardPendingChanges(raw: unknown) {
  const result = await discardPendingWorkspace(raw);
  for (const path of ["/docs", "/runs/new"]) revalidatePath(path);
  return result;
}
