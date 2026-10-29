"use server";
import { analyzeProductChanges } from "@/features/sources/analyze-product-changes";
import type { ProductState } from "@/features/sources/product-change-analysis";
import { SourceReadError } from "@/integrations/github/errors";
export async function runProductAnalysis(_previous: ProductState, form: FormData): Promise<ProductState> {
  const paths = form.get("paths");
  try { return { result: await analyzeProductChanges({ owner: form.get("owner"), repo: form.get("repo"), base: form.get("base"), head: form.get("head"), paths: typeof paths === "string" ? paths.split(/\r?\n/).map(p => p.trim()).filter(Boolean) : paths }) }; }
  catch (error) {
    if (error instanceof Error && "issues" in error) return { error: "Provide owner/name, valid base/head revisions, and up to ten relative context paths." };
    if (error instanceof SourceReadError) return { error: error.message };
    return { error: error instanceof Error ? error.message : "Analysis failed." };
  }
}
