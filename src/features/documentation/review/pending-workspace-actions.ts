"use server";
import { revalidatePath } from "next/cache";
import { getPendingWorkspace, publishPendingWorkspace, type PendingWorkspace } from "./pending-workspace";
export async function previewPendingChanges(raw: unknown): Promise<PendingWorkspace | null> {
  try { return await getPendingWorkspace(raw); } catch { return null; }
}
export async function publishPendingChanges(raw: unknown) {
  const result = await publishPendingWorkspace(raw);
  for (const path of ["/docs", "/mcp", "/documentation/drafts", "/documentation/proposals"]) revalidatePath(path);
  return result;
}
