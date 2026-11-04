import type { ProductImpact, ProductRoute } from "@/features/sources/product-evidence";
import type { DocumentationImpactPlan } from "../planning/documentation-impact";
import type { AssociationChoice } from "../documents/document";
import { publicationRoute } from "../publication/publication-target";

/** The existing semantic plan selects claim refs; pinned component reachability supplies route correspondence. */
export function discoveredAssociations(impact: ProductImpact, plan: DocumentationImpactPlan, decision: DocumentationImpactPlan["decisions"][number], routes: ProductRoute[]): AssociationChoice[] {
  if (decision.action !== "add" || decision.documentId) return [];
  const refs = plan.claimCatalog.filter(claim => decision.claimRefs.includes(claim.id)).flatMap(claim => claim.claim.references);
  const evidenceIds = impact.provenance.sourceReferences.filter(source => refs.includes(source.id)).flatMap(source => source.finding.citations.map(citation => citation.evidenceId));
  const paths = impact.provenance.sourceEvidence.filter(evidence => evidenceIds.includes(evidence.id)).map(evidence => evidence.path);
  const matched = routes.filter(route => paths.some(path => route.sourcePaths.includes(path)));
  const unique = new Set(matched.map(route => route.pathname));
  return routes.filter(route => publicationRoute.safeParse(route.pathname).success && route.evidence.commitId === impact.provenance.source.head).map(route => ({
    id: `${route.id}-${plan.decisions.indexOf(decision) + 1}`, kind: "route", value: route.pathname, origin: "discovery", routeEvidence: { ...route.evidence, requiresConfirmation: route.evidence.requiresConfirmation || route.evidence.method === "runtime-navigation" || unique.size !== 1 || !matched.includes(route) },
  }));
}

/** Observed navigation is a verified screen candidate, but unbound runtime revisions still require confirmation. */
export function observedProductRoutes(impact: ProductImpact): ProductRoute[] {
  return impact.provenance.captures.flatMap((capture): ProductRoute[] => !capture.artifactKey || !publicationRoute.safeParse(capture.finalPathname).success ? [] : [{
    id: `screen-runtime-${capture.captureId}`, pathname: capture.finalPathname,
    evidence: { label: capture.finalPathname === "/" ? "Observed application" : capture.finalPathname.split("/").filter(Boolean).join(" ").slice(0, 100), method: "runtime-navigation", commitId: impact.provenance.source.head,
      sources: [{ path: `capture:${capture.captureId}`, line: 1, excerpt: `Observed pathname: ${capture.finalPathname}` }],
      requiresConfirmation: true, observation: { captureId: capture.captureId, artifactKey: capture.artifactKey, capturedAt: capture.capturedAt, screenshotSha256: capture.screenshotSha256, runtimeRevisionVerified: false } }, sourcePaths: [],
  }]);
}
