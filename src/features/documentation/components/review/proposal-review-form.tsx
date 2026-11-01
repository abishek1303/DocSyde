"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveReviewedChanges } from "../../review/review-actions";
import type { AcceptedReview, ReviewOutcome, ReviewSelection } from "../../review/documentation-review";

type Choice = ReviewSelection["decisions"][number]["choice"];
type Item = { id: string; action: string; reason: string; ready: boolean; issues: string[] };
export function ProposalReviewForm({ proposalId, proposalHash, items, accepted, expired }: {
  proposalId: string; proposalHash: string; items: Item[]; accepted: AcceptedReview | null; expired: boolean;
}) {
  const router = useRouter();
  const [choices, setChoices] = useState<Record<string, Choice>>(() => Object.fromEntries(accepted?.selection.decisions.map(d => [d.decisionId, d.choice]) ?? []));
  const [outcome, setOutcome] = useState<ReviewOutcome>();
  const [pending, startTransition] = useTransition();
  const review = accepted ?? outcome?.review;
  const saves = review?.saves ?? [];
  const unfinished = review?.selection.decisions.some(choice => choice.choice === "approve" && !saves.some(save => save.decisionIds.includes(choice.decisionId)));
  const actionLabels: Record<string, string> = { revise: "Update documentation", add: "Add documentation", "no-change": "No change needed", unresolved: "Needs attention" };
  return <form className="space-y-6" onSubmit={event => {
    event.preventDefault();
    startTransition(async () => {
      const result = await saveReviewedChanges(review ? { proposalId: review.selection.proposalId, expectedProposalHash: review.selection.expectedProposalHash, decisions: review.selection.decisions, ...(review.selection.note ? { note: review.selection.note } : {}) } : { proposalId, expectedProposalHash: proposalHash, decisions: items.map(item => ({ decisionId: item.id, choice: choices[item.id] })) });
      setOutcome(result); router.refresh();
    });
  }}>
    <div className="divide-y rounded-xl border bg-card px-6">{items.map(item => {
      const actionable = item.action === "add" || item.action === "revise";
      return <fieldset key={item.id} className="space-y-3 py-5" disabled={pending || !!review || expired}>
        <legend className="pt-4 font-medium">{actionLabels[item.action] ?? item.action} · {actionable ? item.ready ? "Ready for review" : "Cannot approve" : "Acknowledge or reject"}</legend>
        <p className="text-sm leading-7">{item.reason}</p>
        {item.issues.map((issue, index) => <p key={index} className="text-sm text-muted-foreground">{issue}</p>)}
        <div className="flex gap-6">{([actionable ? "approve" : "acknowledge", "reject"] as Choice[]).map(choice => <label key={choice} className="flex items-center gap-2 text-sm">
          <input type="radio" name={item.id} value={choice} checked={choices[item.id] === choice} required disabled={choice === "approve" && !item.ready}
            onChange={() => setChoices(previous => ({ ...previous, [item.id]: choice }))} />
          {choice === "approve" ? "Approve" : choice === "acknowledge" ? "Acknowledge" : "Reject"}
        </label>)}</div>
      </fieldset>;
    })}</div>
    {expired && <p role="status">This proposal has expired. Start a fresh analysis.</p>}
    {review && <p role="status">Review choices are accepted and locked. Saving does not publish documentation.</p>}
    {(!review || unfinished) && <button type="submit" className="rounded-md border px-4 py-2 disabled:opacity-50" disabled={pending || expired || (!review && items.some(item => !choices[item.id]))}>
      {pending ? "Saving…" : review ? "Resume saving" : "Save reviewed changes"}
    </button>}
    {outcome && <p role={outcome.status === "complete" ? "status" : "alert"}>{outcome.status === "complete" ? "Review saved. Open a saved document to publish it explicitly." : `Review result: ${outcome.status}. ${outcome.reason ?? "Inspect receipts before retrying the identical selection."}`}</p>}
    {saves.length > 0 && <ul className="space-y-3" aria-label="Saved document receipts">{saves.map(save => <li key={save.unitId} className="rounded-md border p-4 text-sm">
      <p>Save: {save.status}{save.reason ? ` · ${save.reason}` : ""}</p>
      {save.status === "saved" && save.documentId && <Link className="underline" href={`/documentation/drafts/${save.documentId}`}>Open saved documentation to publish</Link>}
    </li>)}</ul>}
  </form>;
}
