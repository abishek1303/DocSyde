import type { ProductAnalysis, ProductBundle } from "./product-change-analysis";
import { PRODUCT_CHANGE_EVIDENCE_BUDGET_BYTES } from "./product-change-limits";
export function serializeProductEvidence(bundle: ProductBundle): string {
  // Keep each exact excerpt next to its patch-local line number. Hunk headers
  // contain different source-file coordinates and must never be used as citations.
  const payload = JSON.stringify({ ...bundle, evidence: bundle.evidence.map(({ id, text, ...entry }) => ({ ...entry, evidenceId: id, lines: text === null ? null : text.split("\n").map((line, i) => [i + 1, line]) })) });
  if (Buffer.byteLength(payload, "utf8") > PRODUCT_CHANGE_EVIDENCE_BUDGET_BYTES) throw new Error(`Combined evidence exceeds the ${PRODUCT_CHANGE_EVIDENCE_BUDGET_BYTES}-byte budget. Select fewer context files or a narrower revision range; no model call was made.`);
  return payload;
}
export function validateProductAnalysis(analysis: ProductAnalysis, bundle: ProductBundle): void {
  if (bundle.limited && analysis.assessment === "internal-only") throw new Error("Limited evidence cannot establish internal-only impact for the comparison.");
  if (analysis.assessment !== "insufficient-evidence" && !analysis.findings.length) throw new Error("Assessment requires findings.");
  if (analysis.assessment === "internal-only" && analysis.findings.some(f => f.kind !== "internal-change")) throw new Error("Internal-only assessment conflicts with findings.");
  if (analysis.assessment === "product-change" && !analysis.findings.some(f => !["internal-change", "undetermined"].includes(f.kind))) throw new Error("Product-change assessment requires a behavioral finding.");
  for (const finding of analysis.findings) {
    const cited = finding.citations.map(citation => {
      const evidence = bundle.evidence.find(e => e.id === citation.evidenceId);
      if (evidence?.text === null || !evidence || citation.endLine < citation.startLine || citation.endLine > evidence.text.split("\n").length || (!evidence.text.split("\n").slice(citation.startLine - 1, citation.endLine).join("\n").includes(citation.excerpt) || citation.excerpt.split("\n").length !== citation.endLine - citation.startLine + 1)) throw new Error("Untraceable evidence citation.");
      return evidence;
    });
    if (!cited.some(e => e.changed)) throw new Error("Finding requires change evidence.");
    if (finding.kind === "capability-added" && (!finding.reachabilityEvidenceIds.length || finding.reachabilityEvidenceIds.some(id => !cited.some(e => e.id === id)))) throw new Error("Capability claim requires cited reachability context.");
    if (finding.support === "inferred" && !finding.assumptions.length && !finding.uncertainties.length) throw new Error("Inference requires explicit qualifications.");
  }
}
