"use server";
import { summaryInput, type AnalysisState } from "@/features/sources/change-summary";
import { summarizeChanges } from "@/features/sources/summarize-changes";
export async function analyzeChanges(_previous: AnalysisState, form: FormData): Promise<AnalysisState> {
  const parsed = summaryInput.safeParse({ owner: form.get("owner"), repo: form.get("repo"), base: form.get("base"), head: form.get("head") });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  try { return { result: await summarizeChanges(parsed.data) }; }
  catch (error) { return { error: error instanceof Error && !("issues" in error) ? error.message : "Invalid analysis input." }; }
}
