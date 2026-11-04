import type { DocumentationChangeProposal, DecisionResult } from "./documentation-change-proposal";

/** Only a single selected, verified application destination can join fresh guides.
 * Preview URLs and unresolved route candidates never establish publication identity. */
export function selectedDocumentRoute(proposal: Pick<DocumentationChangeProposal, "authorizations">, result: DecisionResult) {
  if (result.change?.kind !== "add-document") return null;
  const selected = new Set(result.change.associations);
  const routes = proposal.authorizations.find(auth => auth.decisionId === result.decisionId)?.associations
    .filter(choice => selected.has(choice.id) && choice.kind === "route");
  if (!routes?.length || routes.some(choice => choice.origin === "discovery" && choice.routeEvidence?.requiresConfirmation)) return null;
  const paths = [...new Set(routes.map(choice => choice.value))];
  return paths.length === 1 ? paths[0] : null;
}

export function documentUnitId(proposal: Pick<DocumentationChangeProposal, "authorizations" | "results"> & Partial<Pick<DocumentationChangeProposal, "candidates">>, result: DecisionResult): string {
  if (result.decision.documentId) return result.decision.documentId;
  // Frozen historical reviews retain their original unit identity. Only new
  // producer output consolidates; reading an old review must not regroup it.
  const frozen = proposal.candidates?.find(candidate => candidate.decisionIds.includes(result.decisionId));
  if (frozen) return frozen.decisionIds[0];
  const route = selectedDocumentRoute(proposal, result);
  if (!route || !result.reviewReady) return result.decisionId;
  return proposal.results.find(other => other.reviewReady && !other.decision.documentId && selectedDocumentRoute(proposal, other) === route)?.decisionId ?? result.decisionId;
}
