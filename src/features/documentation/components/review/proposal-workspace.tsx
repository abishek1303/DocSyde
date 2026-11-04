import { guideWarnings } from "../../transformation/grounding-risk";
import "server-only";
import { DraftMarkdown } from "../reader/draft-markdown";
import { DraftInspector } from "../reader/draft-inspector";
import { ProposalReviewForm } from "./proposal-review-form";
import { intrinsicReviewReady } from "../../review/materialize-approved-changes";
import type { getDocumentationReviewPresentation } from "../../review/review-proposal-operations";
import type { DocumentationDocument } from "../../documents/document";
import { getDocumentationDraft } from "../../documents/operations";
import { documentationHash } from "../../documents/document-identity";
import { authoredSections } from "../../transformation/transformation-validation";

type Review = Extract<Awaited<ReturnType<typeof getDocumentationReviewPresentation>>, { status: "found" }>;
const prose = "min-w-0 space-y-4 break-words text-base leading-8 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-2 [&_a]:text-primary [&_a]:underline [&_pre]:overflow-x-auto";
function Sections({ sections }: { sections: { title: string; content: { markdown: string }[] }[] }) {
  return <div className={prose}>{sections.map((section, index) => <section key={index} className="space-y-3"><h4 className="text-lg font-semibold">{section.title}</h4>{section.content.map((block, i) => <DraftMarkdown key={i} content={block.markdown} />)}</section>)}</div>;
}
export async function ProposalWorkspace({ review }: { review: Review }) {
  // Once choices are final, preview the saved subset, never a candidate containing rejected changes.
  const approved = review.review ? await Promise.all(review.review.saves.filter(save => save.status === "saved").map(async save => {
    if (!save.documentId) return null;
    const loaded = await getDocumentationDraft(save.documentId, review.repository).catch(() => null);
    return loaded?.status === "found" && documentationHash(loaded.document) === save.sha256 ? loaded.document : null;
  })) : [];
  const previews = review.review ? approved.filter(document => document !== null) : review.proposal.candidates.map(candidate => candidate.document);
  const repository = new URL(review.repository).pathname.slice(1);
  return <div className="space-y-6">
    <ProposalReviewForm key={review.proposalId} proposalId={review.proposalId} proposalHash={review.proposalHash} accepted={review.review} expired={review.expired} repository={repository} canPublish={review.review ? review.targets.some(target => review.review?.saves.some(save => save.unitId === target.unitId && save.status === "saved")) : review.targets.length > 0}
      items={review.proposal.results.map(result => {
        const baseline = review.proposal.targets.find(target => target.document.id === result.decision.documentId)?.document;
        const existing = baseline?.sections.find(section => section.id === result.decision.sectionId);
        const change = result.change, proposed = change ? authoredSections(change) : [];
        const documentTitle = baseline?.title ?? (change && (change.kind === "add-document" || change.kind === "replace-document") ? change.title : "Documentation");
        const retained = change?.kind === "replace-document" ? change.sections.flatMap(entry => entry.kind === "retain" ? baseline?.sections.filter(section => section.id === entry.sectionId) ?? [] : []) : baseline?.sections.filter(section => section.id !== existing?.id) ?? [];
        const title = `${documentTitle}${existing ? ` / ${existing.title}` : change?.kind === "add-section" ? ` / ${change.section.title}` : ""}`;
        const currentSections: DocumentationDocument["sections"] = existing ? [existing] : change?.kind === "add-section" ? [] : baseline?.sections ?? [];
        return { id: result.decisionId, title, action: result.decision.action, reason: result.decision.updateIntent || result.decision.reason,
          warnings: guideWarnings(review.proposal, result.decisionId), ready: (() => { try { return intrinsicReviewReady(review.proposal, result); } catch { return false; } })(), issues: result.issues,
          content: <>
            {proposed.length > 0 && <div className="grid divide-y md:grid-cols-2 md:divide-x md:divide-y-0"><div className="min-w-0 space-y-4 p-5 sm:p-6"><h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current saved content</h3>{currentSections.length ? <Sections sections={currentSections} /> : <p className="text-sm text-muted-foreground">{change?.kind === "add-section" ? "This is a new section." : "This is a new document."}</p>}</div><div className="min-w-0 space-y-4 border-l-primary/25 bg-accent/20 p-5 sm:p-6"><h3 className="text-xs font-medium uppercase tracking-wide text-primary">Updated documentation</h3><Sections sections={proposed} />{retained.length > 0 && <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">{retained.length} unchanged {retained.length === 1 ? "section" : "sections"}</summary><div className="mt-4"><Sections sections={retained} /></div></details>}</div></div>}
            <details className="border-t px-5 py-3 text-sm"><summary className="cursor-pointer text-muted-foreground">Why this change?</summary><div className="mt-3 space-y-3 leading-6"><p>{result.decision.reason}</p><p>{result.support === "supported" ? "Checked against the supplied source and product evidence." : result.reviewOutcome === "warnings" ? "Review with warnings: semantic support remains uncertain." : "This change has not passed all evidence checks."}</p>{result.compositionModel && <p className="text-muted-foreground">Composed with Muse Wonder.</p>}{result.limitations.map((text, i) => <p className="text-muted-foreground" key={i}>{text}</p>)}</div></details>
          </> };
      })} />
    {previews.map(document => <details key={document.id} className="rounded-xl border p-5"><summary className="cursor-pointer text-sm font-medium">{review.review ? "Read approved documentation" : "Preview with all proposed changes"}: {document.title}</summary><div className="mx-auto mt-8 max-w-3xl"><DraftInspector document={document} headingLevel="h2" anchorPrefix={`candidate-${document.id}`} preview showMetadata={false} appearance="help" /></div></details>)}
  </div>;
}
