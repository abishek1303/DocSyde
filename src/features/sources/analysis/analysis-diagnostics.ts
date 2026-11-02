import "server-only";
import { debugHash, debugSection, DEBUG_LIMITS, validationDiagnosticSchema, withValidationDiagnostic } from "@/integrations/ai/invocation-debug";
import { productChangeOutput } from "./product-change-analysis";
import type { ProductAnalysis, ProductBundle, GeneratedProductAnalysis } from "./product-change-analysis";
import { ProductAnalysisValidationError, validateProductAnalysis, reconstructProductAnalysis } from "./product-change-evidence";

// Attach only a bounded projection of the actual model-facing correspondence.
// The invocation lifecycle retains schema-valid output; never write a second raw dump.
export async function validateWithDiagnostics(analysis: ProductAnalysis | GeneratedProductAnalysis, bundle: ProductBundle, serializedInput: string, referencesOnly = false): Promise<ProductAnalysis> {
  try {
    if (referencesOnly) return reconstructProductAnalysis(analysis, bundle);
    const historical = productChangeOutput.parse(analysis);
    validateProductAnalysis(historical, bundle); return historical;
  }
  catch (error) {
    if (error instanceof ProductAnalysisValidationError) {
      try {
        const { code, findingIndex, citationIndex } = error.rejection;
        const citation = findingIndex === undefined || citationIndex === undefined ? undefined : analysis.findings[findingIndex]?.citations[citationIndex];
        const evidence = bundle.evidence.find(e => e.id === citation?.evidenceId);
        const lines = evidence?.text?.split("\n");
        const matchingRanges: [number, number][] = [];
        if (citation && "excerpt" in citation && typeof citation.excerpt === "string" && lines) {
          const span = citation.excerpt.split("\n").length;
          for (let i = 0; i + span <= lines.length && matchingRanges.length < 8; i++) {
            if (lines.slice(i, i + span).join("\n").includes(citation.excerpt)) matchingRanges.push([i + 1, i + span]);
          }
        }
        withValidationDiagnostic(error, validationDiagnosticSchema.parse({
          kind: "grounding-rejection", validator: "source-analysis", code,
          ...(findingIndex !== undefined && citationIndex !== undefined ? { path: `findings[${findingIndex}].citations[${citationIndex}]` } : {}),
          expectedSha256: debugHash(serializedInput), rejectedSha256: debugHash(JSON.stringify(citation ?? { findingIndex, citationIndex })),
          ...(citation ? { citation: debugSection(JSON.stringify({ findingIndex, citationIndex, evidenceId: citation.evidenceId,
            path: evidence?.path ?? null, side: evidence?.side ?? null, returnedRange: [citation.startLine, citation.endLine],
            allowedRange: lines ? [1, lines.length] : null, matchingRanges, matchingRangesLimit: 8,
            excerptSha256: "excerpt" in citation && typeof citation.excerpt === "string" ? debugHash(citation.excerpt) : null, evidenceSha256: evidence?.text == null ? null : debugHash(evidence.text),
            excerptLineCount: "excerpt" in citation && typeof citation.excerpt === "string" ? citation.excerpt.split("\n").length : null,
            returnedRangeLineCount: citation.endLine - citation.startLine + 1,
            excerptOccursInReturnedRange: lines && "excerpt" in citation && typeof citation.excerpt === "string" ? lines.slice(citation.startLine - 1, citation.endLine).join("\n").includes(citation.excerpt) : false,
            contract: referencesOnly ? "model-reference/canonical-excerpt" : "historical-model-excerpt",
            reason: referencesOnly ? "Reference must resolve to available supplied evidence with valid inclusive bounds and a bounded nonempty canonical excerpt." : "Range must be within supplied evidence; excerpt must occur there with the same inclusive line count.",
          }), DEBUG_LIMITS.diagnostic) } : {}),
        }));
      } catch { /* Diagnostics must preserve the original rejection. */ }
    }
    throw error;
  }
}
