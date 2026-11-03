"use client";

import { useActionState } from "react";
import { discardForFullScan } from "@/app/runs/actions";
import { Button } from "@/components/ui/button";

export function FreshFullScanForm({ repository, branch, expectedHash }: { repository: string; branch?: string; expectedHash: string }) {
  const [state, action, pending] = useActionState(discardForFullScan, {});
  return <details className="text-sm">
    <summary className="cursor-pointer rounded-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring">Start fresh Full Scan</summary>
    <form action={action} className="mt-4 space-y-4">
      <input type="hidden" name="repository" value={repository} />
      <input type="hidden" name="branch" value={branch ?? ""} />
      <input type="hidden" name="expectedHash" value={expectedHash} />
      <p className="leading-6 text-muted-foreground">Discard the current pending batch and return to Full Scan setup. Published documentation and archives stay unchanged. Choose a branch and optional context there; the next scan analyzes its current pinned revision.</p>
      <label className="flex items-start gap-3 leading-6"><input type="checkbox" name="confirmed" required disabled={pending} className="mt-1" />I confirm discarding this project’s current pending documentation changes. Their review history will be kept.</label>
      <Button type="submit" variant="outline" disabled={pending} aria-busy={pending}>{pending ? "Discarding…" : "Discard pending changes and set up Full Scan"}</Button>
      {state.error && <p role="alert" className="text-destructive">{state.error}</p>}
    </form>
  </details>;
}
