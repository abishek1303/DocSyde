"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveDraftPreview } from "@/app/documentation/draft/save-actions";
import { Button } from "@/components/ui/button";
import { DraftInspector } from "./draft-inspector";
import type { DocumentationDocument } from "../document";

export function SaveDraftForm({ document, preview, savedAt }: { document: DocumentationDocument; preview: { serialized: string; signature: string }; savedAt?: string | null }) {
  const [state, action, pending] = useActionState(saveDraftPreview, savedAt ? { status: "saved", id: document.id, savedAt, message: "This draft is already saved." } : { status: "idle" });
  return <div className="space-y-4">
    <form action={action} className="space-y-2">
      <input type="hidden" name="serialized" value={preview.serialized} />
      <input type="hidden" name="signature" value={preview.signature} />
      <Button type="submit" disabled={pending || state.status === "saved"}>{pending ? "Saving…" : state.status === "saved" ? "Saved" : "Save draft"}</Button>
      <p role={state.status === "error" ? "alert" : "status"} aria-live="polite">{state.message}</p>
      {state.status === "saved" && <Link className="underline" href={`/documentation/drafts/${state.id}?${new URLSearchParams({ repository: document.provenance.repository })}`}>Open saved draft</Link>}
    </form>
    <DraftInspector document={document} savedAt={state.savedAt} />
  </div>;
}
