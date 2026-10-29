import { PRODUCT_CHANGE_EVIDENCE_BUDGET_BYTES } from "../product-change-limits";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { ProductResult } from "../product-change-analysis";
export function ProductChangeAnalysisResult({ result }: { result: ProductResult }) {
  return <section aria-label="Product analysis result" className="space-y-4"><h2 className="text-xl font-semibold">{result.status === "no-change" ? "No net source change" : result.analysis?.assessment ?? result.status}</h2>
    <p className="break-all text-sm">{result.bundle.repository}<br/>{result.bundle.base} → {result.bundle.head}</p><Badge variant={result.bundle.limited ? "destructive" : "secondary"}>{result.bundle.limited ? "Limited evidence" : "Supplied evidence only"}</Badge>
    <p className="text-sm">{result.bytes} / {PRODUCT_CHANGE_EVIDENCE_BUDGET_BYTES.toLocaleString("en-US")} serialized evidence bytes. {result.bundle.notice}</p>{result.error && <p role="alert" className="text-destructive">{result.error}</p>}
    {result.status === "insufficient-evidence" && <p>Available evidence does not establish overall product impact.</p>}
    {result.analysis?.findings.map((finding, index) => <Card key={index}><CardContent><h3 className="font-semibold">{finding.kind}</h3><p>{finding.description}</p><p>Before: {finding.before ?? "Unknown"}</p><p>After: {finding.after ?? "Unknown"}</p>{finding.audience && <p>Audience: {finding.audience}</p>}{finding.surface && <p>Surface: {finding.surface}</p>}<p>{finding.support} · {finding.confidence} confidence: {finding.confidenceReason}</p>
      {[...finding.assumptions, ...finding.uncertainties].map((text, i) => <p className="text-muted-foreground" key={i}>{text}</p>)}
      {finding.citations.map((citation, i) => <details className="mt-2 rounded border p-2" key={i}><summary className="cursor-pointer">{citation.evidenceId} · lines {citation.startLine}–{citation.endLine}</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{citation.excerpt}</pre><a href={`#evidence-${citation.evidenceId}`} className="underline">Inspect evidence</a></details>)}
    </CardContent></Card>)}
    {result.analysis?.uncertainties.map((text, i) => <p key={i}>{text}</p>)}<p className="text-sm text-muted-foreground">Citation validation establishes traceability, not semantic accuracy. Confidence is not a calibrated probability. {result.model} {result.elapsedMs !== undefined ? `· ${result.elapsedMs} ms` : ""}</p>
    <details><summary className="cursor-pointer">Complete changed-file inventory ({result.bundle.inventory.length})</summary><ul>{result.bundle.inventory.map(file => <li key={file.path}>{file.kind}: {file.previousPath ? `${file.previousPath} → ` : ""}{file.path}</li>)}</ul></details>
    {result.bundle.evidence.map(evidence => <details id={`evidence-${evidence.id}`} key={evidence.id} className="rounded border p-3"><summary className="cursor-pointer break-all">{evidence.id} · {evidence.path} · {evidence.side} · {evidence.status}</summary><p className="break-all text-xs">Commit: {evidence.commitId ?? "base → head patch"} · Content ID: {evidence.contentId ?? "unavailable"}</p>{evidence.commitId && <a className="underline" href={`${result.bundle.repository}/blob/${evidence.commitId}/${evidence.path.split("/").map(encodeURIComponent).join("/")}`}>Pinned file</a>}<pre className="overflow-auto text-xs">{evidence.text === "" ? "Available empty text" : evidence.text?.split("\n").map((line, i) => `${i + 1}  ${line}`).join("\n") ?? "No content supplied"}</pre></details>)}
    <details><summary className="cursor-pointer">Validated structured result</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(result, null, 2)}</pre></details>
  </section>;
}
