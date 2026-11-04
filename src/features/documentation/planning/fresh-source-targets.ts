import type { ProductImpact, ProductRoute } from "@/features/sources/product-evidence";
import type { DocumentationImpactPlan } from "./documentation-impact";
import { documentationImpactClaims } from "./documentation-impact-input";
import { supportsImpactClaim } from "@/features/sources/product-evidence";
import { publicationRoute } from "../publication/publication-target";

/** Local claim support can be sufficient even when the overall bounded scan is incomplete. */
export function freshSourceClaims(impact: ProductImpact) {
  if (impact.contradictions.length || impact.assessment === "internal-only" || impact.provenance.source.base !== impact.provenance.source.head) return [];
  return documentationImpactClaims(impact).filter(({ claim }) => ["behavior-change", "workflow-change", "ui-change"].includes(claim.kind)
    && claim.references.some(id => impact.provenance.sourceReferences.some(source => source.id === id
      && source.finding.support === "directly-supported" && source.finding.citations.length > 0 && supportsImpactClaim(claim.kind, source.finding.kind))));
}

/** Draft intents only. Existing transformation supplies and verifies grounded route associations. */
export function freshFallbackDecisions(impact: ProductImpact, routes: ProductRoute[]): DocumentationImpactPlan["decisions"] {
  return freshSourceClaims(impact).filter(({ claim }) => {
    const ids = impact.provenance.sourceReferences.filter(source => claim.references.includes(source.id)).flatMap(source => source.finding.citations.map(citation => citation.evidenceId));
    const paths = impact.provenance.sourceEvidence.filter(evidence => ids.includes(evidence.id)).map(evidence => evidence.path);
    return routes.some(route => route.evidence.commitId === impact.provenance.source.head && publicationRoute.safeParse(route.pathname).success
      && !route.evidence.requiresConfirmation && route.evidence.method !== "runtime-navigation" && paths.some(path => route.sourcePaths.includes(path)));
  }).map(({ id }) => ({ action: "add", documentId: null, sectionId: null, claimRefs: [id],
    reason: "Fresh draft target supported by cited current product behavior and a verified source route.",
    updateIntent: `Document the current behavior supported by ${id}, limited to its cited source excerpts and qualifications.` }));
}
