import { reliabilityBudget } from "@/integrations/ai/demo-reliability";
// Adjust this deterministic payload limit here; it is independent of review UI limits.
export const PRODUCT_CHANGE_EVIDENCE_BUDGET_BYTES = 100 * 1024;
// The 42,658-byte source-review comparison hit incomplete-output at 4,096 tokens.
export const PRODUCT_CHANGE_OUTPUT_TOKENS = 8192;

// Canonical source context only; source references and support checks remain authoritative.
export const PRODUCT_CITATION_EXCERPT_CHARACTERS = 2000;

export function productEvidenceBudgetBytes() { return reliabilityBudget(PRODUCT_CHANGE_EVIDENCE_BUDGET_BYTES, 256 * 1024); }
