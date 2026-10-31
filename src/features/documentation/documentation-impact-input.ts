import "server-only";
import { z } from "zod";
import type { ProductImpact } from "@/features/sources/product-analysis";
import { getDocumentationDraft, listDocumentationDrafts } from "./operations";

// Match the existing persistence query's repository comparison, without inventing
// Project bindings, URL aliases or logical document/version identities.
export function sameImpactRepository(left: string, right: string) { return left.toLowerCase() === right.toLowerCase(); }

export async function documentationImpactCandidates(repository: string, signal?: AbortSignal) {
  z.url().parse(repository);
  signal?.throwIfAborted();
  const listed = await listDocumentationDrafts({ repository, limit: 10 });
  signal?.throwIfAborted();
  if (listed.nextCursor || listed.entries.length > 10) throw new Error("Documentation impact candidates are incomplete.");
  if (new Set(listed.entries.map(entry => entry.id)).size !== listed.entries.length) throw new Error("Duplicate documentation candidate.");
  const documents = [];
  for (const entry of listed.entries) {
    if (entry.status !== "available" || !sameImpactRepository(entry.repository, repository)) throw new Error("Documentation impact candidate unavailable or repository mismatch.");
    signal?.throwIfAborted();
    const saved = await getDocumentationDraft(entry.id, repository);
    signal?.throwIfAborted();
    if (saved.status !== "found" || saved.document.id !== entry.id || !sameImpactRepository(saved.document.provenance.repository, repository)) {
      throw new Error("Documentation impact candidate unavailable or repository mismatch.");
    }
    const document = saved.document;
    const routes = (ids: string[]) => document.context.filter(choice => ids.includes(choice.id) && choice.kind === "route").map(choice => choice.value);
    documents.push({ id: document.id, title: document.title, routes: routes(document.associations),
      sections: document.sections.map(section => ({ id: section.id, title: section.title, routes: routes(section.associations),
        markdown: section.content.map(block => block.markdown) })),
    });
  }
  // Stable presentation, not an authority or relevance ordering.
  return documents.sort((left, right) => left.id.localeCompare(right.id));
}

export function documentationImpactClaims(impact: ProductImpact) {
  return impact.claims.map((claim, claimIndex) => ({ id: `claim-${claimIndex + 1}`, claimIndex, claim }));
}

export function projectDocumentationImpact(impact: ProductImpact, catalog: ReturnType<typeof documentationImpactClaims>) {
  const sources = new Set(impact.provenance.sourceReferences.map(entry => entry.id));
  return { assessment: impact.assessment, summary: impact.summary,
    claims: catalog.map(({ id, claim: { references, ...claim } }) => ({ id, ...claim,
      sourceSupported: references.some(reference => sources.has(reference)) })),
    uncertainties: impact.uncertainties,
    contradictions: impact.contradictions.map(contradiction => ({ description: contradiction.description, status: contradiction.status,
      claimRefs: catalog.filter(entry => entry.claim.references.some(reference => contradiction.references.includes(reference))).map(entry => entry.id) })),
    coverage: { limited: impact.provenance.source.limited, notice: impact.provenance.source.notice, uncertainties: impact.provenance.source.uncertainties },
  };
}
