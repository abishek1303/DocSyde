import type { DraftProgress } from "./draft-progress";
import "server-only";
import { generateStructured, ModelError } from "@/integrations/ai/generate-structured";
import { analyzeProductChanges, captureGenerationContext, withSourceAccess, productChangeInput, type ProductResult } from "@/features/sources/product-analysis";
import { draftProposal, type DraftResult, type AssociationChoice } from "./document";
import { prepareDraftInput, serializeDraftInput } from "./draft-input";
import { assembleDraft } from "./draft-validation";
import { draftInstructions } from "./draft-prompt";
import { DOCUMENTATION_DRAFT_OUTPUT_TOKENS } from "./draft-limits";
// Server-internal input only: HTTP entry points obtain analysis through Sources.
import { noGenerationContext, type GenerationContextSnapshot } from "@/features/sources/generation-context";
export async function generateDocumentationDraft(analysis: ProductResult, context: AssociationChoice[] = [], generationSnapshot: GenerationContextSnapshot = noGenerationContext, onProgress?: DraftProgress): Promise<DraftResult> {
  const input = prepareDraftInput(analysis, context, generationSnapshot);
  if (!input) return { status: analysis.status === "no-change" ? "no-draft" : "insufficient-evidence", document: null, reason: "No usable validated findings for documentation." };
  const payload = serializeDraftInput(input);
  return withSourceAccess(async () => {
    await onProgress?.({ step: "propose-documentation", status: "running", summary: "Writing structured sections from validated findings." });
    try {
      const generated = await generateStructured({ instructions: draftInstructions, input: payload, schema: draftProposal, maxOutputTokens: DOCUMENTATION_DRAFT_OUTPUT_TOKENS, signal: AbortSignal.timeout(120_000) });
      await onProgress?.({ step: "propose-documentation", status: "completed", summary: `${generated.data.sections.length} proposed sections.` });
      await onProgress?.({ step: "validate-draft", status: "running", summary: "Checking grounding references and canonical document integrity." });
      const document = assembleDraft(generated.data, input, generated.model);
      await onProgress?.({ step: "validate-draft", status: "completed", summary: "Draft structure and provenance validated. Review required." });
      return { status: "draft", document, input };
    } catch (error) {
      return { status: "error", document: null, input, reason: error instanceof ModelError ? `Draft generation failed (${error.code}). Retry manually.` : "Draft structure or grounding references were rejected. No draft accepted." };
    }
  });
}
export async function createDraftFromChanges(raw: unknown, context: AssociationChoice[] = [], runContext: unknown = null, hooks?: { onProgress?: DraftProgress; onAnalysis?: (analysis: ProductResult) => Promise<void>; onContext?: (snapshot: GenerationContextSnapshot) => Promise<void> }): Promise<DraftResult> {
  await hooks?.onProgress?.({ step: "prepare-context", status: "running", summary: "Validating input and capturing product context." });
  const coordinates = productChangeInput.parse(raw);
  const generationSnapshot = await captureGenerationContext(coordinates, runContext);
  await hooks?.onContext?.(generationSnapshot);
  await hooks?.onProgress?.({ step: "prepare-context", status: "completed", summary: "Product and run context frozen for both model calls." });
  const analysis = await analyzeProductChanges(raw, generationSnapshot, hooks?.onProgress);
  await hooks?.onAnalysis?.(analysis);
  if (analysis.status === "error") return { status: "error", document: null, reason: analysis.error ?? "Semantic analysis failed; generation skipped.", analysisRejection: analysis.rejection };
  return generateDocumentationDraft(analysis, context, generationSnapshot, hooks?.onProgress);
}
