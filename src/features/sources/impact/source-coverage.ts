import { ModelError } from "@/integrations/ai/structured-output";
import { allowedImpactClaims, supportsImpactClaim } from "./impact-claim-support";
import type { ProductImpact } from "./product-impact";


export function coverageFailure(code: string): never {
  throw new ModelError("source-coverage-incomplete", undefined, { kind: "grounding-rejection", issues: [{ code, path: "sourceCoverage" }] });
}
export function isProductImpactCoverageError(error: unknown): error is ModelError {
  return error instanceof ModelError && error.code === "source-coverage-incomplete";
}

/** IDs reuse the existing source-N identity within the immutable, ordered pinned snapshot.
 * Claim references carry the mapping, allowing multiple findings per claim without new claim IDs. */
export function validateSourceCoverage(output: Pick<ProductImpact, "claims" | "contradictions" | "sourceCoverage">,
  sources: ProductImpact["provenance"]["sourceReferences"]) {
  const ledger = output.sourceCoverage;
  if (!ledger || ledger.length !== sources.length || new Set(ledger.map(entry => entry.findingId)).size !== sources.length) coverageFailure("missing-or-duplicate-finding");
  const known = new Map(sources.map(source => [source.id, source]));
  const eligible = sources.filter(({ finding }) => finding.support === "directly-supported" && allowedImpactClaims(finding.kind).some(kind => kind !== "internal-change"));
  for (const entry of ledger) {
    const source = known.get(entry.findingId);
    if (!source) coverageFailure("unknown-finding");
    const incorporated = output.claims.some(claim => claim.references.includes(entry.findingId) && supportsImpactClaim(claim.kind, source.finding.kind));
    if ((entry.status === "incorporated") !== incorporated) coverageFailure("claim-coverage-mismatch");
    if (entry.status === "incorporated") continue;
    const contradicted = output.contradictions.some(contradiction => contradiction.references.includes(entry.findingId) && contradiction.references.some(id => id.startsWith("visual:")));
    if (entry.reason === "internal-only" && (entry.status !== "excluded" || source.finding.kind !== "internal-change")) coverageFailure("invalid-internal-exclusion");
    if (entry.reason === "unsupported" && (entry.status !== "excluded" || (source.finding.kind !== "undetermined" && source.finding.support !== "inferred"))) coverageFailure("invalid-unsupported-exclusion");
    if (entry.reason === "contradiction" && (entry.status !== "uncertain" || !contradicted)) coverageFailure("unreferenced-contradiction");
    if (entry.reason === "partial-source" && entry.status !== "uncertain") coverageFailure("invalid-uncertainty");
  }
  // Conservative incomplete result, never manufacture a claim when every supported behavior vanished.
  if (eligible.length && !eligible.some(source => ledger.some(entry => entry.findingId === source.id && entry.status === "incorporated"))
    && !eligible.every(source => ledger.some(entry => entry.findingId === source.id && entry.status === "uncertain" && entry.reason === "contradiction"))) coverageFailure("all-eligible-source-findings-lost");
}
