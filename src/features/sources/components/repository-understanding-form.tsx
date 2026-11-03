"use client";
import { Textarea } from "@/components/ui/textarea";
import { storeProductContext } from "@/app/documentation/draft/context-actions";
import { useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { understandRepository } from "@/app/sources/understanding/actions";
import { Button } from "@/components/ui/button";
export function RepositoryUnderstandingForm({ repository, revision, exists, savedProductContext }: { repository: string; revision: string; exists: boolean; savedProductContext: string }) {
 const [state, action, pending] = useActionState(understandRepository, {});
 const [productContext, setProductContext] = useState(savedProductContext);
 const [saving, setSaving] = useState(false);
 const [saveMessage, setSaveMessage] = useState("");
 async function saveContext() {
  setSaving(true);
  try {
   const [owner, repo] = repository.split("/");
   await storeProductContext(owner, repo, productContext);
   setSaveMessage(productContext.trim() ? "Product context saved." : "Product context cleared.");
  } catch { setSaveMessage("Could not save product context."); }
  finally { setSaving(false); }
 }
 const router = useRouter();
 useEffect(() => { if (state.success) router.refresh(); }, [state, router]);
 return <form action={action} className="space-y-4 rounded-xl border bg-card p-5 sm:p-6">
  <input type="hidden" name="repository" value={repository} /><input type="hidden" name="revision" value={revision} />
  <label htmlFor="onboarding-product-context" className="block text-sm font-medium">Product context (optional)</label>
  <Textarea id="onboarding-product-context" name="productContext" maxLength={500} value={productContext} disabled={pending || saving} onChange={event => setProductContext(event.target.value)} placeholder="Who uses this product, and why?" />
  <p className="text-xs text-muted-foreground">{productContext.length}/500 · Blank analyzes the repository alone. This note is advisory; it cannot establish product behavior. Refresh uses the text shown here.</p>
  <Button type="button" variant="outline" disabled={pending || saving} onClick={saveContext}>Save product context</Button>
  {saveMessage && <p role="status">{saveMessage}</p>}
  <Button type="submit" disabled={pending || saving}>{pending ? "Understanding this product…" : exists ? "Refresh understanding" : "Understand this product"}</Button>
  {pending && <p role="status">Reading selected files, summarizing the product, and saving validated understanding.</p>}
  {state.error && <p role="alert">{state.error}</p>}
 </form>;
}
