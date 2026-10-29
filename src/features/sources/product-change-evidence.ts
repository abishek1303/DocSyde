import type { ProductAnalysis, ProductBundle, AnalysisRejection } from "./product-change-analysis";
import { PRODUCT_CHANGE_EVIDENCE_BUDGET_BYTES } from "./product-change-limits";
export function serializeProductEvidence(bundle: ProductBundle): string {
  // Keep each exact excerpt next to its patch-local line number. Hunk headers
  // contain different source-file coordinates and must never be used as citations.
  const payload = JSON.stringify({ ...bundle, evidence: bundle.evidence.map(({ id, text, ...entry }) => ({ ...entry, evidenceId: id, lines: text === null ? null : text.split("\n").map((line, i) => [i + 1, line]) })) });
  if (Buffer.byteLength(payload, "utf8") > PRODUCT_CHANGE_EVIDENCE_BUDGET_BYTES) throw new Error(`Combined evidence exceeds the ${PRODUCT_CHANGE_EVIDENCE_BUDGET_BYTES}-byte budget. Select fewer context files or a narrower revision range; no model call was made.`);
  return payload;
}
// Only fixed codes and numeric positions escape validation; never source/model bodies.
export class ProductAnalysisValidationError extends Error {
  constructor(public readonly rejection: AnalysisRejection) {
    super(`Semantic analysis rejected: ${rejection.code}`);
  }
}
function reject(code: string, findingIndex?: number, citationIndex?: number): never {
  throw new ProductAnalysisValidationError({ stage: "evidence-validation", code, ...(findingIndex !== undefined ? { findingIndex } : {}), ...(citationIndex !== undefined ? { citationIndex } : {}) });
}
export function validateProductAnalysis(analysis: ProductAnalysis, bundle: ProductBundle): void {
  if (bundle.limited && analysis.assessment === "internal-only") reject("limited-evidence-internal-only");
  if (analysis.assessment !== "insufficient-evidence" && !analysis.findings.length) reject("assessment-without-findings");
  if (analysis.assessment === "internal-only" && analysis.findings.some(f => f.kind !== "internal-change")) reject("internal-only-conflict");
  if (analysis.assessment === "product-change" && !analysis.findings.some(f => !["internal-change", "undetermined"].includes(f.kind))) reject("product-change-without-behavior");
  for (const [findingIndex, finding] of analysis.findings.entries()) {
    const cited = finding.citations.map((citation, citationIndex) => {
      const evidence = bundle.evidence.find(e => e.id === citation.evidenceId);
      if (!evidence) reject("unknown-evidence", findingIndex, citationIndex);
      if (evidence.text === null) reject("unavailable-evidence", findingIndex, citationIndex);
      const lines = evidence.text.split("\n");
      if (citation.endLine < citation.startLine || citation.endLine > lines.length) reject("invalid-line-range", findingIndex, citationIndex);
      if (!lines.slice(citation.startLine - 1, citation.endLine).join("\n").includes(citation.excerpt) || citation.excerpt.split("\n").length !== citation.endLine - citation.startLine + 1) reject("citation-range-mismatch", findingIndex, citationIndex);
      return evidence;
    });
    if (!cited.some(e => e.changed)) reject("missing-change-evidence", findingIndex);
    if (finding.kind === "capability-added" && (!finding.reachabilityEvidenceIds.length || finding.reachabilityEvidenceIds.some(id => !cited.some(e => e.id === id)))) reject("missing-reachability-evidence", findingIndex);
    if (finding.support === "inferred" && !finding.assumptions.length && !finding.uncertainties.length) reject("unqualified-inference", findingIndex);
  }
}
