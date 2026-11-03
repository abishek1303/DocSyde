"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DraftMarkdown } from "../reader/draft-markdown";
import { tryProductKnowledge } from "../../knowledge/mcp-actions";
import type { KnowledgeResult, KnowledgeToolName } from "../../knowledge/knowledge-contract";

const samples: { label: string; tool: KnowledgeToolName }[] = [
  { label: "What does this product currently do?", tool: "get_product_context" },
  { label: "What happens when an issue is Blocked?", tool: "get_documentation" },
  { label: "Give me the current context for this product page.", tool: "get_context_for_surface" },
];
export function McpDemo({ repository, enabled, initialRoute }: { repository: string; enabled: boolean; initialRoute: string }) {
  const [tool, setTool] = useState<KnowledgeToolName>("get_product_context"), [route, setRoute] = useState(initialRoute);
  const [error, setError] = useState("");
  const [result, setResult] = useState<KnowledgeResult>(), [pending, start] = useTransition();
  return <section className="space-y-5 rounded-xl border bg-card p-5 sm:p-7" aria-labelledby="try-mcp">
    <div className="space-y-2"><h2 id="try-mcp" className="text-xl font-semibold">Try product context</h2><p className="max-w-2xl text-sm leading-6 text-muted-foreground">See what an agent receives from the same read-only query used by MCP. This retrieves published documentation; it does not generate an answer or run a model.</p></div>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); start(async () => {
      try { setResult(await tryProductKnowledge(tool, { repository, ...(tool === "get_product_context" ? {} : { route }) })); }
      catch { setResult(undefined); setError("The request could not be completed. Please try again."); }
    }); }}>
      <label className="block space-y-2 text-sm font-medium">Agent-style question<select aria-label="Agent-style question" className="block w-full rounded-md border bg-card px-3 py-3 text-sm" value={tool} disabled={pending} onChange={event => { setTool(event.target.value as KnowledgeToolName); setResult(undefined); setError(""); }}>{samples.map(sample => <option key={sample.tool} value={sample.tool}>{sample.label}</option>)}</select></label>
      {tool !== "get_product_context" && <label className="block space-y-2 text-sm font-medium">Product route<Input disabled={pending} aria-label="Product route" value={route} onChange={event => { setRoute(event.target.value); setResult(undefined); setError(""); }} placeholder="Choose an exact published product route" required maxLength={300} /><span className="block text-xs font-normal text-muted-foreground">Exact page matching. The question is a demo label; the route selects the documentation.</span></label>}
      <Button disabled={!enabled || pending} type="submit" onClick={() => setError("")}>{pending ? "Reading current knowledge…" : "Get current context"}</Button>
    </form>
    {error && <p role="alert" className="text-sm">{error}</p>}
    {result && <div aria-live="polite" className="space-y-6 border-t pt-6">
      <p role={result.status === "available" || result.status === "no-live-documentation" ? "status" : "alert"} className="text-sm text-muted-foreground">{result.message}</p>
      {result.documents.map(document => <article key={`${document.documentId}:${document.route}`} className="mx-auto max-w-3xl space-y-5">
        <div className="space-y-2"><p className="text-xs font-medium text-primary">Approved · Live documentation</p><h3 className="text-2xl font-semibold">{document.title}</h3><p className="break-words text-xs text-muted-foreground">{document.route} · Published {new Date(document.version.publishedAt).toLocaleString()}</p></div>
        {document.sections.map((section, index) => <section key={index} className="space-y-3 break-words text-base leading-8 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_pre]:overflow-x-auto"><h4 className="border-b pb-3 text-lg font-semibold">{section.title}</h4>{section.blocks.map((text, i) => <DraftMarkdown key={i} content={text} />)}</section>)}
        <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Source and coverage</summary><div className="mt-3 space-y-2 text-xs leading-6 text-muted-foreground">{document.version.sourceRevision && <p>Repository revision {document.version.sourceRevision.slice(0, 12)}</p>}{document.limitations.map((text, i) => <p key={i}>{text}</p>)}</div></details>
      </article>)}
      {result.orientation && <details className="rounded-lg border p-4 text-sm"><summary className="cursor-pointer font-medium">Repository orientation · Advisory snapshot</summary><div className="mt-4 space-y-3 leading-7"><p className="text-muted-foreground">This snapshot may lag live documentation. It does not establish current product behavior.</p><p>{result.orientation.purpose}</p><p>Audience: {result.orientation.audience}</p><p className="text-xs text-muted-foreground">As of {new Date(result.orientation.asOf).toLocaleString()}</p>{result.orientation.gaps.length > 0 && <ul className="list-disc pl-5">{result.orientation.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul>}</div></details>}
      {result.moreDocuments && <p className="text-sm text-muted-foreground">More live documentation is available. Choose a product route for its full context.</p>}
    </div>}
  </section>;
}
