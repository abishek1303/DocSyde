import "server-only";
// Deliberately narrow cross-feature boundary; Sources retains evidence ownership.
export { analyzeProductChanges } from "./analyze-product-changes";
export { productChangeOutput } from "./product-change-analysis";
export type { ProductResult, ProductAnalysis, AnalysisRejection } from "./product-change-analysis";
export { validateProductAnalysis } from "./product-change-evidence";
export { withSourceAccess } from "./local-source-access";
