import "server-only";
// Model-free evidence contract for deterministic downstream operations.
export { productImpactSchema } from "./impact/product-impact";
export { validateProductImpact } from "./impact/validate-product-impact";
export type { ProductImpact } from "./impact/product-impact";

// Read-only persisted run contracts; no generation/provider capabilities.
export { productChangeInput } from "./analysis/product-change-analysis";
export { storedProductResult } from "./analysis/stored-product-result";
export { generationContextSnapshot } from "./context/generation-context";
export { inspectionSupportSchema } from "./runtime/inspection-capabilities";
export { runtimeInspectionContextSchema } from "./runtime/runtime-inspection-context";
export { inspectionDecisionSchema } from "./runtime/inspection-decision";
