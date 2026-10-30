"use client";
import { createRepositoryContextRequests } from "./repository-context-requests";
import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { loadProductContext, storeProductContext } from "@/app/documentation/draft/context-actions";
export function ProductContextInputs({ owner, repo }: { owner: string; repo: string }) {
  const [repositoryText, setRepositoryText] = useState("");
  const [runText, setRunText] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  const [requests] = useState(createRepositoryContextRequests);
  useEffect(() => {
    const ticket = requests.begin();
    let active = true;
    loadProductContext(owner, repo).then(text => { if (active && requests.isCurrent(ticket)) { setRepositoryText(text ?? ""); setMessage(""); } }).catch(() => { if (active && requests.isCurrent(ticket)) setMessage("Could not load optional product context. No context was copied from another repository."); }).finally(() => { if (active && requests.isCurrent(ticket)) setBusy(false); });
    return () => { active = false; requests.cancel(); };
  }, [owner, repo, requests]);
  async function save(text: string) {
    const ticket = requests.begin();
    setBusy(true);
    try { const saved = await storeProductContext(owner, repo, text); if (requests.isCurrent(ticket)) { setRepositoryText(saved ?? ""); setMessage(saved ? "Product context saved." : "Product context cleared."); } }
    catch { if (requests.isCurrent(ticket)) setMessage("Could not save product context. Retry before generating."); }
    finally { if (requests.isCurrent(ticket)) setBusy(false); }
  }
  return <div className="space-y-3 rounded-lg border p-4">
    <label htmlFor="repository-context" className="block font-medium">What should we know about this product?</label>
    <Textarea id="repository-context" maxLength={500} disabled={busy} value={repositoryText} onChange={event => setRepositoryText(event.target.value)} placeholder="A request tracker for nontechnical support staff. Keep guides practical and beginner-friendly." />
    <p className="text-xs text-muted-foreground">{repositoryText.length}/500 · Optional. Generation uses the saved value; save changes before generating.</p>
    <div className="flex gap-2"><Button type="button" disabled={busy} onClick={() => save(repositoryText)}>Save product context</Button><Button type="button" variant="outline" disabled={busy} onClick={() => save("")}>Clear</Button></div>
    <p role="status" className="text-sm">{message}</p>
    <label htmlFor="run-context" className="block font-medium">Anything specific for this run?</label>
    <Textarea id="run-context" name="runContext" maxLength={300} value={runText} onChange={event => setRunText(event.target.value)} placeholder="Focus on creating and closing requests." />
    <p className="text-xs text-muted-foreground">{runText.length}/300 · Optional. Used for this run only. Context guides writing; source evidence defines behavior.</p>
  </div>;
}
