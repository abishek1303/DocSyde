"use client";
import { useActionState } from "react";
import { confirmDestination } from "@/app/runs/[id]/destinations/actions";
import { Button } from "@/components/ui/button";
export function DestinationForm({ runId, expectedHash, options }: { runId: string; expectedHash: string; options: { id: string; label: string; route: string; confirmed: boolean; automatic: boolean }[] }) {
  const [state, action, pending] = useActionState(confirmDestination, {});
  return <form action={action} className="space-y-4">
    <input type="hidden" name="runId" value={runId} /><input type="hidden" name="expectedHash" value={expectedHash} />
    <label className="block space-y-2"><span className="text-sm font-medium">Application screen</span><select name="targetId" required defaultValue={options.find(option => option.confirmed)?.id ?? options.find(option => option.automatic)?.id ?? ""} disabled={pending} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="" disabled>Choose a discovered screen</option>{options.map(option => <option key={option.id} value={option.id}>{option.label} ({option.route})</option>)}</select></label>
    <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" name="confirmed" required disabled={pending} className="mt-1" />This screen is where users should find this documentation.</label>
    <Button type="submit" disabled={pending}>Confirm destination</Button>
    {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}{state.message && <p role="status" className="text-sm">{state.message}</p>}
  </form>;
}
