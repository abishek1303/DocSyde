"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { IllustratedEmptyState } from "@/components/application/illustrated-empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { BookOpen, FileText, ArrowRight, CheckCircle2, X, AlertTriangle } from "lucide-react";
import { DraftInspector } from "../reader/draft-inspector";
import { previewPendingChanges, publishPendingChanges, discardPendingChanges } from "../../review/pending-workspace-actions";
import type { PendingWorkspace } from "../../review/pending-workspace";

export function PendingPublishWorkspace({ initial, focusProposal }: { initial: PendingWorkspace; focusProposal?: string }) {
  const [view, setView] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [removedImages, setRemovedImages] = useState<string[]>(initial.groups.flatMap(group => group.images.filter(choice => choice.removed).map(choice => choice.image.id)));
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState<string[]>([]);
  const needsAcknowledgment = view.groups.flatMap(group => group.changes).some(change => !change.excluded && change.warnings.length > 0 && !acknowledgedWarnings.includes(change.key));
  const router = useRouter();
  const families = new Map<string, PendingWorkspace["groups"]>();
  for (const group of view.groups) {
    const key = group.conflictKey ?? group.key;
    families.set(key, [...(families.get(key) ?? []), group]);
  }
  const rows = [...families.entries()].sort(([, a], [, b]) => Number(b.some(group => group.changes.some(change => change.proposalId === focusProposal))) - Number(a.some(group => group.changes.some(change => change.proposalId === focusProposal))));
  const rejectedKeys = view.groups.flatMap(group => group.changes).filter(change => change.excluded).map(change => change.key);
  const rejectedCount = view.groups.flatMap(group => group.changes).filter(change => change.excluded).length;
  async function updateExcluded(excluded: string[]) {
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
      const result = await publishPendingChanges({ repository: view.repository, expectedHash: view.hash, acknowledgedWarnings, removedImages, excluded: view.groups.flatMap(group => group.changes).filter(change => change.excluded).map(change => change.key) });
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
  if (!view.groups.length) return <div className="min-h-0 flex-1 overflow-y-auto"><IllustratedEmptyState kind="pending" title="No pending changes yet" headingLevel="h1" action={<Link className={buttonVariants({ size: "lg" })} href={`/docs?${new URLSearchParams({ repository: view.repository })}`}><BookOpen aria-hidden="true" />View latest docs</Link>} /></div>;
  return <div className="flex min-h-0 flex-1 flex-col gap-4" aria-busy={busy}>
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Pending changes</h1>
      <div className="flex flex-wrap gap-2"><Button variant="ghost" disabled={busy} onClick={discard}>Discard all</Button><Button disabled={busy || view.blocked || view.count === 0 || needsAcknowledgment} onClick={publish}>{busy ? "Updating…" : `Publish ${view.count} ${view.count === 1 ? "change" : "changes"}`}<ArrowRight className="size-4" aria-hidden="true" /></Button></div>
    </header>
    <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-card px-4 py-3 text-xs text-muted-foreground"><span className="font-medium text-foreground">{rows.length} {rows.length === 1 ? "page" : "pages"}</span><span className="flex items-center gap-2"><CheckCircle2 className="size-4 text-success" aria-hidden="true" />{view.count} included</span><span>{rejectedCount} excluded</span>{needsAcknowledgment && <span className="text-warning">Review warnings to publish</span>}{view.blocked && <span className="flex items-center gap-2 text-warning"><AlertTriangle className="size-4" aria-hidden="true" />Choose a version for each conflict</span>}</div>
    {error && <p role="alert" className="shrink-0 rounded-lg border border-destructive/30 p-3 text-sm">{error} <button className="underline" onClick={() => window.location.reload()}>Reload workspace</button></p>}
    <div aria-label="Pending pages" tabIndex={0} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-2 pb-2 [scrollbar-width:thin]">
      {rows.map(([key, groups]) => {
        const changes = groups.flatMap(group => group.changes);
        const versions = groups.flatMap(group => group.versions.map(version => ({ ...version, group })));
        const includedKeys = changes.filter(change => !change.excluded).map(change => change.key);
        const chosen = versions.find(version => version.changeKeys.length === includedKeys.length && version.changeKeys.every(key => includedKeys.includes(key)));
        const conflict = groups.some(group => group.conflictKey);
        const group = chosen?.group ?? groups[0];
        const rejected = changes.every(change => change.excluded);
        const proposed = rejected ? null : conflict ? chosen?.document : group.document;
        const title = proposed?.title ?? group.title;
        const sources = chosen?.imageSources ?? group.imageSources;
        const routes = [...new Set(groups.flatMap(group => group.routes))];
        const before = group.baseline;
        const rowKeys = changes.map(change => change.key);
        async function selectVersion(value: string) {
          const version = versions.find(version => version.key === value);
          if (!version) return;
          await updateExcluded([...new Set([...rejectedKeys.filter(key => !rowKeys.includes(key)), ...rowKeys.filter(key => !version.changeKeys.includes(key))])]);
        }
        return <section key={key} aria-label={`Pending document: ${title}`} className={`grid gap-4 rounded-xl border bg-card p-4 lg:h-[18rem] lg:grid-cols-[13rem_minmax(0,1fr)_5rem] lg:gap-5 ${rejected ? "border-dashed opacity-70" : conflict && !chosen ? "border-warning/40" : ""}`}>
          <div className="min-h-0 min-w-0 space-y-3 overflow-y-auto [scrollbar-width:thin]">
            <FileText className="size-5 text-primary" aria-hidden="true" /><h2 className="break-words text-sm font-semibold leading-6">{title}</h2>
            <p className="break-all font-mono text-xs leading-5 text-muted-foreground">{routes.join(" · ") || "Route unavailable"}</p>
            <p className="text-xs text-muted-foreground">{changes.length} {changes.length === 1 ? "change" : "changes"} · {includedKeys.length} included</p>
            <div className="flex flex-wrap gap-2"><span className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">{before ? "Update" : "New page"}</span>{conflict && <span className="rounded-md bg-warning-background px-2 py-1 text-xs font-medium text-warning">{chosen ? "Version selected" : "Conflict"}</span>}</div>
            {conflict && <div className="space-y-2"><label htmlFor={`version-${key}`} className="block text-xs font-medium">Choose one version</label><select id={`version-${key}`} value={chosen?.key ?? ""} disabled={busy} onChange={event => { void selectVersion(event.target.value); }} className="h-9 w-full rounded-md border bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"><option value="" disabled>Select a version</option>{versions.map((version, index) => <option key={version.key} value={version.key} disabled={!version.document}>Version {index + 1} · {version.label}</option>)}</select></div>}
            {changes.some(change => change.warnings.length > 0) && <details className="rounded-md border border-warning/30 p-3 text-xs"><summary className="cursor-pointer font-medium text-warning">Review warnings</summary><div className="mt-3 space-y-3">{changes.filter(change => change.warnings.length > 0).map(change => <div key={change.key} className="space-y-2">{change.warnings.map(warning => <p key={warning.unitId} className="leading-5 text-muted-foreground">{warning.reason}</p>)}<label className="flex items-start gap-2 leading-5"><input type="checkbox" checked={acknowledgedWarnings.includes(change.key)} disabled={busy || change.excluded} onChange={event => setAcknowledgedWarnings(previous => event.target.checked ? [...previous, change.key] : previous.filter(key => key !== change.key))} />I reviewed these warnings.</label></div>)}</div></details>}
            {group.images.filter(choice => choice.removed).map(choice => <button type="button" key={choice.image.id} disabled={busy} onClick={() => toggleImage(choice.image.id)} className="block text-left text-xs text-primary underline">Restore screenshot: {choice.sectionTitle}</button>)}
          </div>
          <div className={`grid min-h-0 gap-3 ${before ? "md:grid-cols-2" : ""}`}>
            {before && <PendingPreview label="Before" document={before} prefix={`before-${key}`} imageSources={group.imageSources} />}
            <PendingPreview label={before ? "After" : "Preview"} document={proposed ?? null} prefix={`after-${key}`} imageSources={sources} empty={rejected ? "This page is excluded." : conflict ? "Choose a version to preview." : group.issue ?? "Preview unavailable."} renderImageActions={image => <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => toggleImage(image.id)} aria-label={`Remove screenshot: ${image.alt}`}>Remove image</Button>} />
          </div>
          <div className="flex items-center justify-end"><Button variant="outline" size="sm" disabled={busy} onClick={() => updateExcluded(rejected ? rejectedKeys.filter(key => !rowKeys.includes(key)) : [...new Set([...rejectedKeys, ...rowKeys])])} aria-label={`${rejected ? "Restore" : "Reject"} ${title}`}>{!rejected && <X className="size-3" aria-hidden="true" />}{rejected ? "Restore" : "Reject"}</Button></div>
        </section>;
      })}
    </div>
  </div>;
}

type PreviewProps = { label: string; document: PendingWorkspace["groups"][number]["document"]; prefix: string; imageSources: Record<string, string>; empty?: string; renderImageActions?: React.ComponentProps<typeof DraftInspector>["renderImageActions"] };
function PendingPreview({ label, document, prefix, imageSources, empty, renderImageActions }: PreviewProps) {
  return <div className="flex h-72 min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-background/40 lg:h-full">
    <h3 className={`shrink-0 border-b px-4 py-2.5 text-xs font-semibold ${label === "Before" ? "text-muted-foreground" : "text-primary"}`}>{label}</h3>
    <div tabIndex={0} aria-label={`${label} documentation`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-width:thin] [&_article]:space-y-4 [&_h3]:pb-2 [&_h3]:text-sm [&_h3]:leading-6 [&_article>div]:space-y-5 [&_article>div]:px-0 [&_section]:space-y-3 [&_section>div]:text-sm [&_section>div]:leading-6">{document ? <DraftInspector document={document} headingLevel="h2" anchorPrefix={prefix} showMetadata={false} showContents={false} showTitle={false} appearance="help" imageSources={imageSources} renderImageActions={renderImageActions} /> : <p className="text-sm leading-6 text-muted-foreground">{empty}</p>}</div>
  </div>;
}
