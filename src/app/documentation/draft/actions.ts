"use server";
import { z } from "zod";
import { createDraftFromChanges } from "@/features/documentation/generate-documentation-draft";
import { associationChoice, type DraftResult } from "@/features/documentation/document";
import { SourceReadError } from "@/integrations/github/errors";
export async function runDraft(_previous: DraftResult | null, form: FormData): Promise<DraftResult> {
  try {
    const paths = form.get("paths"); const contextText = form.get("context");
    const context = z.array(associationChoice).max(20).parse(typeof contextText === "string" && contextText.trim() ? JSON.parse(contextText) : []);
    if (context.some(c => c.origin !== "operator" || c.findingRef)) throw new Error("Only explicit operator associations may be supplied.");
    return await createDraftFromChanges({ owner: form.get("owner"), repo: form.get("repo"), base: form.get("base"), head: form.get("head"), paths: typeof paths === "string" ? paths.split(/\r?\n/).map(p => p.trim()).filter(Boolean) : paths }, context);
  } catch (error) {
    return { status: "error", document: null, reason: error instanceof SourceReadError ? error.message : error instanceof Error && ("issues" in error || error instanceof SyntaxError) ? "Check repository/revisions, paths, and association JSON." : error instanceof Error ? error.message : "Draft workflow failed." };
  }
}
