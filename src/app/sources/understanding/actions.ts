"use server";
import { refreshUnderstanding } from "@/features/sources/context/understanding-operations";
export async function understandRepository(_previous: { error?: string; success?: boolean }, form: FormData): Promise<{ error?: string; success?: boolean }> {
 try {
  const repository = form.get("repository"), revision = form.get("revision");
  if (typeof repository !== "string" || typeof revision !== "string") throw new Error("Invalid selection");
  await refreshUnderstanding(repository, revision, form.get("productContext"));
  return { success: true };
 } catch { return { error: "Understanding could not be saved. Any previous successful result is preserved. Check repository access, model configuration and database migrations." }; }
}
