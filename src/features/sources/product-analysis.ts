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
