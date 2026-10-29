"use server";
import { z } from "zod";
import { createDraftFromChanges } from "@/features/documentation/generate-documentation-draft";
import { associationChoice, type DraftResult } from "@/features/documentation/document";
import { SourceReadError } from "@/integrations/github/errors";
import { signDraftPreview } from "@/features/documentation/draft-handoff";
export async function runDraft(_previous: DraftResult | null, form: FormData): Promise<DraftResult> {
  try {
    const paths = form.get("paths"); const contextText = form.get("context");
    const context = z.array(associationChoice).max(20).parse(typeof contextText === "string" && contextText.trim() ? JSON.parse(contextText) : []);
    if (context.some(c => c.origin !== "operator" || c.findingRef)) throw new Error("Only explicit operator associations may be supplied.");
    const result = await createDraftFromChanges({ owner: form.get("owner"), repo: form.get("repo"), base: form.get("base"), head: form.get("head"), paths: typeof paths === "string" ? paths.split(/\r?\n/).map(p => p.trim()).filter(Boolean) : paths }, context);
    if (!result.document) return result;
    try { return { ...result, preview: signDraftPreview(result.document) }; }
    catch { return { ...result, saveUnavailable: "Saving is unavailable. Configure DOCSYDE_DRAFT_SIGNING_KEY with at least 32 characters; this preview remains available." }; }
  } catch (error) {
    return { status: "error", document: null, reason: error instanceof SourceReadError ? error.message : error instanceof Error && ("issues" in error || error instanceof SyntaxError) ? "Check repository/revisions, paths, and association JSON." : error instanceof Error ? error.message : "Draft workflow failed." };
  }
}
