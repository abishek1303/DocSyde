import "server-only";
// Deliberately narrow cross-feature boundary; Sources retains evidence ownership.
export { analyzeProductChanges } from "./analysis/analyze-product-changes";
export { productChangeInput, productChangeOutput } from "./analysis/product-change-analysis";
export type { ProductResult, ProductAnalysis, AnalysisRejection } from "./analysis/product-change-analysis";
export { validateProductAnalysis } from "./analysis/product-change-evidence";
export { withSourceAccess } from "./repository/local-source-access";

export { captureGenerationContext } from "./context/repository-context";
export type { GenerationContextSnapshot } from "./context/generation-context";

export { assertAllowedRepository } from "./repository/local-source-access";
export { pinChangeInput, readSelectedChange } from "./repository/selected-change";
export type { SourceProgress, SourceStep } from "./analysis/analysis-progress";
export { storedProductResult } from "./analysis/stored-product-result";
export { generationContextSnapshot } from "./context/generation-context";
export { productImpactSchema } from "./impact/product-impact";
export type { ProductImpact } from "./impact/product-impact";
export { validateProductImpact } from "./impact/validate-product-impact";

export { decideRuntimeInspection } from "./runtime/decide-runtime-inspection";
export { inspectionDecisionSchema } from "./runtime/inspection-decision";
export { synthesizeProductImpact } from "./impact/synthesize-product-impact";
export { analyzeRuntimeVisuals } from "./runtime/analyze-runtime-visuals";
export { validateProductResult } from "./analysis/validate-product-result";
export { runtimeInspectionContextSchema } from "./runtime/runtime-inspection-context";
export type { RuntimeInspectionContext } from "./runtime/runtime-inspection-context";

export { previewSourceComparison } from "./repository/prepare-comparison";

export { ProductEvidenceBudgetError } from "./analysis/product-change-evidence";

export { inspectionCapabilitySchema, inspectionSupportSchema } from "./runtime/inspection-capabilities";
export { readInspectionContext } from "./runtime/read-inspection-context";

export { selectedRepository } from "./repository/repository-overview";

export { discoverProductRoutes } from "./runtime/discover-product-routes";
