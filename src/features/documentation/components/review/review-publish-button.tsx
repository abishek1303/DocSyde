"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { publishReviewChanges } from "../../review/publish-review-action";
export function ReviewPublishButton({ proposalId, proposalHash, repository }: { proposalId: string; proposalHash: string; repository: string }) {
  const router = useRouter(), [pending, start] = useTransition(), [error, setError] = useState("");
  return <div className="space-y-3"><Button type="button" disabled={pending} onClick={() => start(async () => {
    setError("");
    const result = await publishReviewChanges({ proposalId, expectedProposalHash: proposalHash });
    if (result.status === "published") router.push(`/docs?${new URLSearchParams({ repository, published: "1", ...(result.documentId ? { document: result.documentId } : {}) })}`);
    else { setError(result.status === "conflict" ? "Live documentation changed. Refresh and check it before publishing these changes." : "These changes could not be published. Check that approvals have been saved and a publication destination is available."); router.refresh(); }
  })}>{pending ? "Publishing…" : "Publish changes"}</Button><p className="text-sm text-muted-foreground">This makes your approved changes live. The previous live version moves to Archive.</p>{error && <p role="alert" className="text-sm">{error}</p>}</div>;
}
