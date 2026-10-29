"use server";

import { verifyDraftPreview } from "@/features/documentation/draft-handoff";
import { saveDocumentationDraft } from "@/features/documentation/operations";

type SaveState = { status: "idle" | "saved" | "error"; message?: string; id?: string; savedAt?: string };

export async function saveDraftPreview(_previous: SaveState, form: FormData): Promise<SaveState> {
  let document;
  try {
    document = verifyDraftPreview(form.get("serialized"), form.get("signature"));
  } catch {
    return { status: "error", message: "Draft verification failed. The signed preview may have changed or the signing key is unavailable." };
  }
  try {
    const result = await saveDocumentationDraft(document);
    if (result.status === "conflict") return { status: "error", message: "This document ID already has different saved content. Nothing was overwritten." };
    return { status: "saved", id: result.document.id, savedAt: result.savedAt.toISOString(), message: "Draft saved. Reopening it requires no model calls." };
  } catch {
    return { status: "error", message: "Could not save the draft. Check PostgreSQL and migrations, then retry saving this preview." };
  }
}
