"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DraftInspector } from "../reader/draft-inspector";
import { previewPendingChanges, publishPendingChanges, discardPendingChanges } from "../../review/pending-workspace-actions";
import type { PendingWorkspace } from "../../review/pending-workspace";

export function PendingPublishWorkspace({ initial, focusProposal }: { initial: PendingWorkspace; focusProposal?: string }) {
  const [view, setView] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [removedImages, setRemovedImages] = useState<string[]>(initial.groups.flatMap(group => group.images.filter(choice => choice.removed).map(choice => choice.image.id)));
  const router = useRouter();
  const focused = view.groups.filter(group => group.changes.some(change => change.proposalId === focusProposal));
  const orderedGroups = [...focused, ...view.groups.filter(group => !focused.includes(group))];
  const affected = view.groups.filter(group => group.changes.some(change => !change.unavailable && !change.excluded)).length;
  async function toggle(key: string) {
    const rejected = view.groups.flatMap(group => group.changes).filter(change => change.excluded).map(change => change.key);
    const excluded = rejected.includes(key) ? rejected.filter(value => value !== key) : [...rejected, key];
    setBusy(true); setError("");
    try {
      const next = await previewPendingChanges({ repository: view.repository, excluded, removedImages });
      if (next) setView(next); else setError("The pending workspace changed. Reload to see the current documentation.");
    } catch { setError("The preview could not be updated. Please try again."); }
    finally { setBusy(false); }
  }
  async function toggleImage(id: string) {
    const next = removedImages.includes(id) ? removedImages.filter(value => value !== id) : [...removedImages, id];
    setBusy(true); setError("");
    try {
      const updated = await previewPendingChanges({ repository: view.repository, excluded: view.groups.flatMap(group => group.changes).filter(change => change.excluded).map(change => change.key), removedImages: next });
      if (updated) { setView(updated); setRemovedImages(next); } else setError("The screenshot preview changed. Reload before publishing.");
    } catch { setError("The screenshot selection could not be updated."); }
    finally { setBusy(false); }
  }
  async function publish() {
    setBusy(true); setError("");
    try {
      const result = await publishPendingChanges({ repository: view.repository, expectedHash: view.hash, removedImages, excluded: view.groups.flatMap(group => group.changes).filter(change => change.excluded).map(change => change.key) });
      if (result.status === "published") { router.push(`/docs?${new URLSearchParams({ repository: view.repository, published: "1" })}`); router.refresh(); }
      else setError(result.message);
    } catch { setError("Publication could not be confirmed. Reload before trying again."); }
    finally { setBusy(false); }
  }
  async function discard() {
    if (!window.confirm("Discard all pending documentation changes for this project? Published documentation will stay unchanged.")) return;
    setBusy(true); setError("");
    try {
      const result = await discardPendingChanges({ repository: view.repository, expectedHash: view.hash, confirmed: true });
      if (result.status === "discarded") { router.push(`/runs/new?${new URLSearchParams({ repository: view.repository })}`); router.refresh(); }
      else setError(result.message);
    } catch { setError("Discard could not be confirmed. Reload before trying again."); }
    finally { setBusy(false); }
  }
  if (!view.groups.length) return <section className="space-y-2 rounded-xl border border-dashed p-8"><h2 className="font-medium">No documentation changes waiting for review.</h2><Link className="inline-block text-sm text-primary underline" href={`/docs?${new URLSearchParams({ repository: view.repository })}`}>View Latest Docs →</Link><p className="text-sm text-muted-foreground">New documentation updates will appear here after a change analysis.</p><Link className="inline-block text-sm text-primary underline" href={`/documentation/drafts?${new URLSearchParams({ repository: `https://github.com/${view.repository}` })}`}>Browse saved documents</Link></section>;
  return <div className="mx-auto w-full max-w-4xl space-y-10" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-5 border-b pb-6">
      <div className="space-y-2"><h2 className="text-lg font-semibold">{view.count} {view.count === 1 ? "change" : "changes"} across {affected} {affected === 1 ? "document" : "documents"}</h2><p className="max-w-xl text-sm leading-6 text-muted-foreground">Read the combined result below. Exclude anything you don’t want, then publish the remaining updates together.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !view.groups.some(group => group.changes.some(change => !change.unavailable))} onClick={discard}>Discard pending changes</Button>
      <Button disabled={busy || view.blocked || view.count === 0} onClick={publish}>{busy ? "Updating…" : `Publish ${view.count} ${view.count === 1 ? "change" : "changes"}`}</Button></div>
    </div>
    {error && <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm">{error} <button className="underline" onClick={() => window.location.reload()}>Reload workspace</button></p>}
    {view.blocked && <p role="alert" className="text-sm text-destructive">Some included changes overlap. Exclude a conflicting change before publishing.</p>}
    {orderedGroups.map(group => <section key={group.key} aria-label={`Pending document: ${group.title}`} className="space-y-6 border-b pb-10 last:border-0">
      <div className="space-y-3">{focused.includes(group) && <p className="text-xs font-medium text-primary">Changes from your run</p>}<h2 className="text-xl font-semibold">{group.title}</h2>
        <ul className="divide-y rounded-lg border">{group.changes.map(change => <li key={change.key} className={`flex items-start justify-between gap-4 px-4 py-3 ${change.excluded ? "bg-muted/30" : ""}`}>
          <div className="min-w-0 space-y-1"><p className={`text-sm font-medium ${change.excluded ? "text-muted-foreground line-through" : ""}`}>{change.label}</p><p className="text-sm leading-6 text-muted-foreground">{change.reason}</p>
            {change.unavailable && <p className="text-sm text-destructive">{change.unavailable}</p>}
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Why this change?</summary><p className="mt-2 leading-6">{change.unavailable ? "This change is not included in publication." : "This edit passed the existing source and product evidence support checks."}</p><a className="mt-2 inline-block text-primary underline" href={`/documentation/proposals/${change.proposalId}`}>Evidence and comparison</a></details>
          </div>
          {!change.unavailable && <Button variant="ghost" size="sm" disabled={busy} onClick={() => toggle(change.key)} aria-label={`${change.excluded ? "Undo rejection of" : "Reject"} ${group.title} / ${change.label}`}>{change.excluded ? "Undo" : "Reject"}</Button>}
        </li>)}</ul>
      </div>
      {group.issue && <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm">{group.issue}</p>}
      {group.images.filter(choice => choice.removed).map(choice => <button type="button" key={choice.image.id} disabled={busy} onClick={() => toggleImage(choice.image.id)} className="rounded text-sm text-primary underline focus-visible:outline-2 focus-visible:outline-ring">Restore screenshot for {choice.sectionTitle}</button>)}
      {group.document && <div className="mx-auto max-w-3xl" aria-label={`Combined preview: ${group.title}`}><DraftInspector document={group.document} headingLevel="h2" anchorPrefix={`pending-${group.key}`} showMetadata={false} showContents={false} showTitle={false} appearance="help" highlightedSections={group.highlighted} imageSources={group.imageSources} renderImageActions={image => <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => toggleImage(image.id)} aria-label={`Remove screenshot: ${image.alt}`}>Remove image</Button>} /></div>}
    </section>)}
  </div>;
}
