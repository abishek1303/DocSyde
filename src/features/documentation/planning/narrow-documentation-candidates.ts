import type { DocumentationDocument } from "../documents/document";
import { CANDIDATE_DOCUMENT_LIMIT, CANDIDATE_SECTION_LIMIT, type CandidateMatch, type CandidateQuery } from "./candidate-selection";

/** Only a section's own cited findings link it to a historical file. Never infer
 * feature names from filenames, inherit every document source, or equate line IDs
 * from different v2 evidence contexts. No canonical snapshot is changed. */
export function sectionSourcePaths(document: DocumentationDocument, sectionId: string): string[] {
  const section = document.sections.find(section => section.id === sectionId);
  if (!section) return [];
  return [...new Set(document.provenance.findings.filter(finding => section.findingRefs.includes(finding.id)).flatMap(finding =>
    document.provenance.evidence.filter(evidence => finding.citations.some(citation => citation.evidenceId === evidence.id)
      && (!("contextId" in finding) || "contextId" in evidence && finding.contextId === evidence.contextId)).map(evidence => evidence.path)))].sort();
}

function supportTier(match: CandidateMatch, query: CandidateQuery, distinctive: (token: string) => boolean, distinctRoute: (route: string) => boolean, distinctSource: (path: string) => boolean, distinctFeature: (feature: string) => boolean) {
  const direct = match.reasons.some(reason => reason.kind === "source-path" && reason.paths.some(distinctSource) || reason.kind === "existing-section"
    || reason.kind === "association" && ["feature", "workflow", "ui-surface"].includes(reason.associationKind) && distinctFeature(`${reason.associationKind}:${reason.value}`));
  if (direct) return 2;
  const heading = match.reasons.some(reason => reason.kind === "section-title" && reason.tokens.length >= 2);
  const distinctiveHeading = match.reasons.some(reason => reason.kind === "section-title" && reason.tokens.length >= 2 && reason.tokens.some(distinctive));
  const body = match.reasons.some(reason => reason.kind === "section-text" && reason.tokens.length >= 3);
  const observed = match.reasons.some(reason => reason.kind === "association" && reason.associationKind === "route" && query.observedRoutes?.includes(reason.value) && distinctRoute(reason.value));
  return heading && (observed || distinctiveHeading && body) ? 1 : 0;
}

/** Rank for presentation, retain every directly supported target, never fill a
 * top-N quota by UUID/recency. A large equally plausible set stays incomplete. */
export function narrowDocumentationCandidates(matches: CandidateMatch[], query: CandidateQuery) {
  const documents = new Set(matches.map(match => match.documentId));
  const titleDocuments = new Map<string, Set<string>>(), routeDocuments = new Map<string, Set<string>>(), sourceDocuments = new Map<string, Set<string>>(), featureDocuments = new Map<string, Set<string>>();
  for (const match of matches) for (const reason of match.reasons) {
    const values = reason.kind === "section-title" ? reason.tokens : reason.kind === "source-path" ? reason.paths : reason.kind === "association" ? [reason.associationKind === "route" ? reason.value : `${reason.associationKind}:${reason.value}`] : [];
    const counts = reason.kind === "section-title" ? titleDocuments : reason.kind === "source-path" ? sourceDocuments : reason.kind === "association" && reason.associationKind !== "route" ? featureDocuments : routeDocuments;
    for (const value of values) { const ids = counts.get(value) ?? new Set<string>(); ids.add(match.documentId); counts.set(value, ids); }
  }
  // Common headings and root routes cannot make every broad match "strong".
  const threshold = Math.max(1, Math.floor(documents.size / 4));
  const distinctSource = (path: string) => (sourceDocuments.get(path)?.size ?? 0) <= CANDIDATE_DOCUMENT_LIMIT;
  const tier = (match: CandidateMatch) => supportTier(match, query, token => (titleDocuments.get(token)?.size ?? 0) <= threshold, route => (routeDocuments.get(route)?.size ?? 0) <= CANDIDATE_DOCUMENT_LIMIT, distinctSource, feature => (featureDocuments.get(feature)?.size ?? 0) <= CANDIDATE_DOCUMENT_LIMIT);
  const ranked = [...matches].sort((a, b) => tier(b) - tier(a) || b.score - a.score || a.documentId.localeCompare(b.documentId) || a.sectionId.localeCompare(b.sectionId));
  const ids = (items: CandidateMatch[]) => [...new Set(items.map(match => match.documentId))].sort();
  const supportedDocuments = ids(ranked.filter(match => tier(match) > 0)).length;
  const fits = (items: CandidateMatch[]) => items.length <= CANDIDATE_SECTION_LIMIT && ids(items).length <= CANDIDATE_DOCUMENT_LIMIT;
  if (fits(ranked)) return { matches: ranked, ids: ids(ranked), supportedDocuments, outcome: "within-bounds" as const };
  // Preserve both direct and strong section/runtime matches: weaker direct matches
  // do not vanish merely because another document scores higher.
  const supported = ranked.filter(match => tier(match) > 0);
  if (!supported.length || !fits(supported)) return { matches: [], ids: [], supportedDocuments, outcome: "ambiguous" as const, constraint: supported.length ? "supported-targets" as const : "indistinguishable-matches" as const };
  const relevant = (match: CandidateMatch, claim: NonNullable<CandidateQuery["claimSignals"]>[number], allowSharedSource = false) => {
    const words = new Set(match.reasons.flatMap(reason => "tokens" in reason ? reason.tokens : []));
    return match.reasons.some(reason => reason.kind === "source-path" && reason.paths.some(path => claim.sourcePaths.includes(path) && (allowSharedSource || distinctSource(path)))
      || reason.kind === "existing-section" && claim.priorText !== undefined && reason.texts.includes(claim.priorText))
      || claim.tokens.filter(token => words.has(token)).length >= 2;
  };
  const omitted = ranked.filter(match => !supported.includes(match));
  // A clear target for one claim cannot erase unresolved candidates for another.
  if (query.claimSignals?.some(claim => omitted.some(match => relevant(match, claim, true)) && !supported.some(match => relevant(match, claim))))
    return { matches: [], ids: [], supportedDocuments, outcome: "ambiguous" as const, constraint: "uncovered-claim-targets" as const };
  return { matches: supported, ids: ids(supported), supportedDocuments, outcome: "evidence-narrowed" as const };
}
