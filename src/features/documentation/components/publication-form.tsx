"use client";
import { useActionState, useState } from "react";
import { changePublication, type PublicationState } from "../publication-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PublicationForm({ owner, repo, draftId, initial }: { owner: string; repo: string; draftId: string; initial: PublicationState }) {
  const [state, action, pending] = useActionState(changePublication, initial);
  const [route, setRoute] = useState(initial.route);
  const checked = state.available && state.route === route;
  const current = checked ? state.publication : null;
  return <form action={action} className="mb-8 space-y-3 rounded-lg border p-4" aria-label="Publish saved documentation">
    <h2 className="font-semibold">Contextual publication</h2>
    <p className="text-sm text-muted-foreground">Publish this saved snapshot to one exact host pathname. Saving alone never publishes.</p>
    <input type="hidden" name="owner" value={owner} /><input type="hidden" name="repo" value={repo} /><input type="hidden" name="draftId" value={draftId} />
    <input type="hidden" name="observedId" value={current?.id ?? ""} />
    <label className="block text-sm" htmlFor="publication-route">Host pathname</label>
    <Input id="publication-route" name="route" value={route} onChange={event => setRoute(event.target.value)} required maxLength={300} />
    {checked && <p className="text-sm">{current ? `Published document: ${current.draftId}` : "No publication at this target."}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="submit" variant="outline" name="intent" value="inspect" disabled={pending}>Check target</Button>
      <Button type="submit" name="intent" value="publish" disabled={pending || !checked || !!current && current.draftId !== draftId}>Publish</Button>
      {current && current.draftId !== draftId && <Button type="submit" name="intent" value="replace" disabled={pending}>Replace publication with this document</Button>}
      {current && <Button type="submit" variant="outline" name="intent" value="unpublish" disabled={pending}>Unpublish target</Button>}
    </div>
    <p role="status" className="text-sm">{pending ? "Updating publication…" : state.message}</p>
  </form>;
}
