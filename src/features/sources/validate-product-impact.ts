import { productImpactSchema } from "./product-impact";
import { RUNTIME_REVISION_WARNING } from "./runtime-visual-evidence";

function reject(): never { throw new Error("Product impact reference graph is invalid."); }
function unique<T>(entries: T[], identity: (entry: T) => string) {
  const map = new Map(entries.map(entry => [identity(entry), entry]));
  if (map.size !== entries.length) reject();
  return map;
}

/** Revalidates retained structure/correspondence, not source excerpts or visual truth.
 * Server callers must pass the direct validated synthesis result, not client JSON. */
export function validateProductImpact(raw: unknown) {
  const impact = productImpactSchema.parse(raw);
  const { source, sourceReferences, sourceEvidence, captures, visualReferences } = impact.provenance;
  if (!/^[a-f0-9]{40}$/i.test(source.base) || !/^[a-f0-9]{40}$/i.test(source.head)) reject();
  const sources = unique(sourceReferences, entry => entry.id);
  const evidence = unique(sourceEvidence, entry => entry.id);
  const captured = unique(captures, entry => entry.captureId);
  const visuals = unique(visualReferences, entry => entry.id);
  unique(sourceReferences, entry => String(entry.findingIndex));
  unique(visualReferences, entry => `${entry.captureId}:${entry.collection}:${entry.index}`);
  for (const entry of sourceEvidence) {
    if (entry.commitId !== (entry.side === "patch" ? null : source[entry.side])) reject();
  }
  const cited = new Set<string>();
  for (const [index, entry] of sourceReferences.entries()) {
    if (entry.findingIndex !== index || entry.id !== `source-${entry.findingIndex + 1}`) reject();
    for (const citation of entry.finding.citations) {
      if (!evidence.has(citation.evidenceId) || citation.endLine < citation.startLine) reject();
      cited.add(citation.evidenceId);
    }
    if (entry.finding.reachabilityEvidenceIds.some(id => !entry.finding.citations.some(citation => citation.evidenceId === id))) reject();
  }
  if (cited.size !== evidence.size) reject();
  for (const entry of visualReferences) {
    if (sources.has(entry.id) || !captured.has(entry.captureId)
      || entry.id !== `visual:${entry.captureId}:${entry.collection}:${entry.index}`
      || entry.index >= (entry.collection === "elements" ? 20 : 10)) reject();
  }
  for (const capture of captures) for (const collection of ["elements", "observations"] as const) {
    const indices = visualReferences.filter(entry => entry.captureId === capture.captureId && entry.collection === collection).map(entry => entry.index).sort((a, b) => a - b);
    if (indices.some((index, position) => index !== position)) reject();
  }
  let visualUsed = false;
  function resolve(references: string[]) {
    if (new Set(references).size !== references.length) reject();
    for (const id of references) if (!sources.has(id) && !visuals.has(id)) reject();
    const staticRefs = references.flatMap(id => { const entry = sources.get(id); return entry ? [entry] : []; });
    const visual = references.some(id => visuals.has(id)); visualUsed ||= visual;
    return { staticRefs, visual };
  }
  const productKinds = new Set(["workflow-changed", "field-requirement-changed", "capability-added", "behavior-modified", "behavior-removed"]);
  for (const claim of impact.claims) {
    const refs = resolve(claim.references);
    if (claim.kind === "visual-observation") {
      if (!refs.visual || claim.before !== null || claim.after !== null) reject();
    } else {
      const compatible = refs.staticRefs.filter(({ finding }) => claim.kind === "internal-change" ? finding.kind === "internal-change"
        : claim.kind === "workflow-change" ? finding.kind === "workflow-changed" : productKinds.has(finding.kind));
      if (!compatible.length || ((claim.before !== null || claim.after !== null) && !compatible.some(({ finding }) =>
        (claim.before === null || claim.before === finding.before) && (claim.after === null || claim.after === finding.after)))) reject();
    }
  }
  for (const contradiction of impact.contradictions) {
    const refs = resolve(contradiction.references);
    if (!refs.staticRefs.length || !refs.visual) reject();
  }
  if (impact.contradictions.length && impact.assessment !== "insufficient-evidence") reject();
  if (impact.assessment === "product-change" && !impact.claims.some(claim => ["behavior-change", "workflow-change", "ui-change"].includes(claim.kind))) reject();
  if (impact.assessment === "internal-only" && (source.limited || !impact.claims.some(claim => claim.kind === "internal-change")
    || impact.claims.some(claim => ["behavior-change", "workflow-change", "ui-change"].includes(claim.kind)))) reject();
  if (visualUsed && !impact.uncertainties.includes(RUNTIME_REVISION_WARNING)) reject();
  return impact;
}
