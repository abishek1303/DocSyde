import "server-only";
// Deliberately narrow cross-feature boundary; Sources retains evidence ownership.
export { analyzeProductChanges } from "./analyze-product-changes";
export { productChangeInput, productChangeOutput } from "./product-change-analysis";
export type { ProductResult, ProductAnalysis, AnalysisRejection } from "./product-change-analysis";
export { validateProductAnalysis } from "./product-change-evidence";
export { withSourceAccess } from "./local-source-access";

export { captureGenerationContext } from "./repository-context";
export type { GenerationContextSnapshot } from "./generation-context";

export { assertAllowedRepository } from "./local-source-access";
export { pinChangeInput, readSelectedChange } from "./selected-change";
export type { SourceProgress, SourceStep } from "./analysis-progress";
export { storedProductResult } from "./stored-product-result";
export { generationContextSnapshot } from "./generation-context";
export { productImpactSchema } from "./product-impact";
export type { ProductImpact } from "./product-impact";
export { validateProductImpact } from "./validate-product-impact";

export { decideRuntimeInspection } from "./decide-runtime-inspection";
export { inspectionDecisionSchema } from "./inspection-decision";
export { synthesizeProductImpact } from "./synthesize-product-impact";
export { analyzeRuntimeVisuals } from "./analyze-runtime-visuals";
export { validateProductResult } from "./validate-product-result";
export { runtimeInspectionContextSchema } from "./runtime-inspection-context";
export type { RuntimeInspectionContext } from "./runtime-inspection-context";

export { previewSourceComparison } from "./prepare-comparison";

export { ProductEvidenceBudgetError } from "./product-change-evidence";

export { inspectionCapabilitySchema, inspectionSupportSchema } from "./inspection-capabilities";
export { readInspectionContext } from "./read-inspection-context";
