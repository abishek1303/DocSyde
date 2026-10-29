// Adjust this deterministic payload limit here; it is independent of review UI limits.
export const PRODUCT_CHANGE_EVIDENCE_BUDGET_BYTES = 64 * 1024;
// The 42,658-byte source-review comparison hit incomplete-output at 4,096 tokens.
export const PRODUCT_CHANGE_OUTPUT_TOKENS = 8192;
