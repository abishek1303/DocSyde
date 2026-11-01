import type { ProductAnalysis } from "./product-change-analysis";
import type { ProductImpact } from "./product-impact";

type ClaimKind = ProductImpact["claims"][number]["kind"];
type FindingKind = ProductAnalysis["findings"][number]["kind"];
const productKinds = new Set<FindingKind>(["workflow-changed", "field-requirement-changed", "capability-added", "behavior-modified", "behavior-removed"]);
export function supportsImpactClaim(claim: ClaimKind, finding: FindingKind) {
  return claim === "internal-change" ? finding === "internal-change"
    : claim === "workflow-change" ? finding === "workflow-changed"
    : (claim === "behavior-change" || claim === "ui-change") && productKinds.has(finding);
}
export function allowedImpactClaims(finding: FindingKind): ClaimKind[] {
  return (["behavior-change", "workflow-change", "ui-change", "internal-change"] as ClaimKind[]).filter(kind => supportsImpactClaim(kind, finding));
}
