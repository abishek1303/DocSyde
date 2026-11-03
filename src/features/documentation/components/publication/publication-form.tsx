"use client";
import { useActionState, useEffect, useState } from "react";
import { changePublication, type PublicationState } from "../../publication/publication-actions";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PublicationForm({ owner, repo, draftId, initial }: { owner: string; repo: string; draftId: string; initial: PublicationState }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(changePublication, initial);
  const [route, setRoute] = useState(initial.route);
  useEffect(() => {
    if (state.message.startsWith("Published.") && state.publication?.draftId === draftId) router.push(`/docs?${new URLSearchParams({ repository: `${owner}/${repo}`, published: "1", document: draftId })}`);
  }, [state, draftId, owner, repo, router]);
  const checked = state.available && state.route === route;
  const current = checked ? state.publication : null;
  return <form action={action} className="mb-8 space-y-3 rounded-lg border p-4" aria-label="Publish saved documentation">
    <h2 className="font-semibold">Publish documentation</h2>
    <p className="text-sm text-muted-foreground">Publish when you’re ready to make this documentation live. Approval and saving do not publish it.</p>
    <input type="hidden" name="owner" value={owner} /><input type="hidden" name="repo" value={repo} /><input type="hidden" name="draftId" value={draftId} />
    <input type="hidden" name="observedId" value={current?.id ?? ""} />
    <label className="block text-sm" htmlFor="publication-route">Product page</label>
    <Input id="publication-route" name="route" value={route} onChange={event => setRoute(event.target.value)} required maxLength={300} />
    {checked && <p className="text-sm">{current ? current.draftId === draftId ? "This document is live." : "Another version is currently live here." : "No documentation is live here yet."}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" variant="outline" name="intent" value="inspect" disabled={pending}>Check target</Button>
      <Button type="submit" name="intent" value={current && current.draftId !== draftId ? "replace" : "publish"} disabled={pending || !checked || current?.draftId === draftId}>Publish changes</Button>
      {current?.draftId === draftId && <details className="w-full text-sm"><summary className="cursor-pointer text-muted-foreground">More publication options</summary><Button className="mt-3" type="submit" variant="outline" name="intent" value="unpublish" disabled={pending}>Remove from live documentation</Button></details>}
    </div>
    <p role="status" className="text-sm">{pending ? "Updating publication…" : state.message}</p>
  </form>;
}
