"use client";
import { useActionState } from "react";
import { retryRun } from "@/app/runs/actions";
import { Button } from "@/components/ui/button";
export function RetryRunForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(retryRun, {});
  return <form action={action} className="space-y-2"><input type="hidden" name="id" value={id} /><Button type="submit" variant="outline" disabled={pending}>{pending ? "Creating attempt…" : "Start a new attempt"}</Button><p className="text-xs text-muted-foreground">A new attempt performs analysis again. Saving a draft never requires a new attempt.</p>{state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}</form>;
}
