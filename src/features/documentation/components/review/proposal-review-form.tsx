"use client";

import { type ReactNode, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { saveReviewedChanges } from "../../review/review-actions";
import type { AcceptedReview, ReviewOutcome, ReviewSelection } from "../../review/documentation-review";
import { ReviewPublishButton } from "./review-publish-button";

type Choice = ReviewSelection["decisions"][number]["choice"];
type Item = { id: string; action: string; title?: string; reason: string; ready: boolean; issues: string[]; warnings?: { unitId: string; category?: string; reason: string; factRefs?: string[] }[]; content?: ReactNode };
export function ProposalReviewForm({ proposalId, proposalHash, repository, canPublish = false, items, accepted, expired }: {
  proposalId: string; proposalHash: string; repository: string; canPublish?: boolean; items: Item[]; accepted: AcceptedReview | null; expired: boolean;
}) {
  const router = useRouter();
  const [choices, setChoices] = useState<Record<string, Choice>>(() => Object.fromEntries(accepted?.selection.decisions.map(d => [d.decisionId, d.choice]) ?? items.filter(item => !["add", "revise"].includes(item.action)).map(item => [item.id, "acknowledge"])));
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<ReviewOutcome>();
  const [pending, startTransition] = useTransition();
  const review = accepted ?? outcome?.review, saves = review?.saves ?? [];
  const unfinished = review?.selection.decisions.some(choice => choice.choice === "approve" && !saves.some(save => save.status === "saved" && save.decisionIds.includes(choice.decisionId)));
  const approved = review?.selection.decisions.some(choice => choice.choice === "approve");
  return <form className="space-y-6" onSubmit={event => {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveReviewedChanges(review ? { proposalId: review.selection.proposalId, expectedProposalHash: review.selection.expectedProposalHash, decisions: review.selection.decisions, ...(review.selection.note ? { note: review.selection.note } : {}) } : { proposalId, expectedProposalHash: proposalHash, decisions: items.map(item => ({ decisionId: item.id, choice: choices[item.id], ...(acknowledged.includes(item.id) ? { acknowledgeWarnings: true } : {}) })) });
      setOutcome(result); router.refresh();
    });
  }}>
    <p className="text-sm text-muted-foreground">{items.filter(item => item.ready && !(item.warnings ?? []).length).length} ready · {items.filter(item => item.ready && (item.warnings ?? []).length > 0).length} with warnings · {items.filter(item => ["add", "revise"].includes(item.action) && !item.ready).length} blocked. Human review required.</p>
    {!review && !expired && <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-xl text-sm leading-6 text-muted-foreground">Choose which changes to accept, then confirm your review. Approved changes are saved; publishing is a separate step.</p><Button type="button" variant="outline" disabled={pending || !items.some(item => item.ready)} onClick={() => setChoices(previous => ({ ...previous, ...Object.fromEntries(items.filter(item => item.ready).map(item => [item.id, "approve" as const])) }))}>Approve all</Button></div>}
    {items.map(item => {
      const actionable = item.action === "add" || item.action === "revise";
      const choice = review?.selection.decisions.find(decision => decision.decisionId === item.id)?.choice ?? choices[item.id];
      return <section key={item.id} id={`change-${item.id}`} className="scroll-mt-6 overflow-hidden rounded-xl border bg-card">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4"><div className="min-w-0 space-y-2"><h2 className="text-lg font-semibold">{item.title ?? (item.action === "add" ? "New documentation" : "Documentation update")}</h2><p className="max-w-3xl text-sm leading-6 text-muted-foreground">{item.reason}</p></div><span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">{choice === "approve" ? review ? "Approved" : "Selected for approval" : choice === "reject" ? review ? "Rejected" : "Selected for rejection" : actionable ? !item.ready ? "Blocked" : (item.warnings ?? []).length ? "Review with warnings" : "Ready for review" : item.action === "unresolved" ? "Needs attention" : "No update required"}</span></header>
        {item.content}
        <fieldset className="flex flex-wrap gap-4 border-t px-5 py-4" disabled={pending || !!review || expired}>
          <legend className="sr-only">Review {item.title ?? "documentation change"}</legend>
          {([actionable ? "approve" : "acknowledge", "reject"] as Choice[]).map(value => <label key={value} className="flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm has-checked:border-primary has-checked:bg-accent has-disabled:cursor-default has-disabled:opacity-60">
            <input type="radio" name={item.id} value={value} checked={choice === value} required disabled={value === "approve" && !item.ready} onChange={() => setChoices(previous => ({ ...previous, [item.id]: value }))} />{value === "approve" ? "Approve" : value === "reject" ? "Reject" : "Acknowledge"}
          </label>)}
          {(item.warnings ?? []).length > 0 && <div className="w-full space-y-2 text-sm"><p>Review with warnings — uncertain semantic support</p>{(item.warnings ?? []).map(warning => <p key={warning.unitId}>{warning.category}: {warning.reason} (evidence: {warning.factRefs?.join(", ")})</p>)}<label className="flex items-center gap-2"><input type="checkbox" checked={acknowledged.includes(item.id) || !!review?.selection.decisions.find(choice => choice.decisionId === item.id)?.acknowledgeWarnings} onChange={event => setAcknowledged(previous => event.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))} />I reviewed these warnings and their evidence.</label></div>}
          {actionable && !item.ready && <p className="w-full text-sm text-muted-foreground">This change needs another analysis before it can be approved.</p>}
        </fieldset>
      </section>;
    })}
    {expired && !review && <p role="status">This review has expired. Run a fresh analysis to prepare new changes.</p>}
    {review && <p role="status" className="text-sm">{approved ? "Approvals saved. Publish separately to make these changes live." : "Review complete. No changes were approved."} Review decisions are final.</p>}
    {(!review || unfinished) && <Button type="submit" disabled={pending || (!review && expired) || (!review && items.some(item => !choices[item.id] || (choices[item.id] === "approve" && (item.warnings ?? []).length > 0 && !acknowledged.includes(item.id))))}>{pending ? "Saving approvals…" : review ? "Resume saving approvals" : "Confirm review"}</Button>}
    {outcome && outcome.status !== "complete" && <p role="alert" className="text-sm">Your review could not be fully saved. Refresh to check your choices before continuing.</p>}
    {review && !unfinished && approved && (canPublish ? <ReviewPublishButton proposalId={proposalId} proposalHash={proposalHash} repository={repository} /> : <p className="text-sm text-muted-foreground">Your changes are saved. Open the saved document in Pending Changes to choose where to publish it.</p>)}
  </form>;
}
