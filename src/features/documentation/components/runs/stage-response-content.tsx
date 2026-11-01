import type { RunResponseStage } from "../../runs/run-stage-response";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function entries(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(object) : [];
}

/** Presentation of already validated, saved output only. No regeneration or new evidence. */
export function StageResponseContent({ text, preview, stage, label }: { text: string; preview?: string; stage: RunResponseStage; label: string }) {
  let data: Record<string, unknown> = {};
  try { data = object(JSON.parse(text)); } catch { /* The original saved response stays available below. */ }
  const captures = stage === "runtime-inspection" ? entries(data.observations).map(entry => object(entry.response)) : [];
  const observations = captures.flatMap(capture => strings(capture.observations));
  const statements = [...entries(data.findings), ...entries(data.claims), ...entries(data.decisions)];
  const limits = [...new Set([...strings(data.uncertainties), ...captures.flatMap(capture => strings(capture.limitations)), ...statements.flatMap(entry => [...strings(entry.uncertainties), ...strings(entry.assumptions)])])];
  const points = statements.flatMap(entry => {
    const value = [entry.description, entry.updateIntent, entry.reason].find(value => typeof value === "string" && value.trim());
    return typeof value === "string" && value.trim() ? [{ text: value, support: entry.support, confidence: entry.confidence }] : [];
  });
  const summary = typeof data.summary === "string" ? data.summary : typeof data.reason === "string" ? data.reason : preview;
  return <div className="space-y-5 text-sm leading-7">
    {summary && <p>{summary}</p>}
    {points.length > 0 && <ul className="list-disc space-y-3 pl-5">{points.map((point, index) => <li key={index}><p>{point.text}</p>{(point.support === "inferred" || point.confidence === "low" || point.confidence === "medium") && <p className="text-xs text-muted-foreground">{point.support === "inferred" ? "Inferred from source. " : ""}{point.confidence === "low" ? "Low confidence." : point.confidence === "medium" ? "Medium confidence." : ""}</p>}</li>)}</ul>}
    {observations.length > 0 && <section aria-label="Observed in the app" className="space-y-2"><h3 className="font-medium">Observed in the app</h3><ul className="list-disc space-y-2 pl-5">{observations.map((point, index) => <li key={index}>{point}</li>)}</ul></section>}
    {limits.length > 0 && <section aria-label="Evidence limitations" className="rounded-lg border p-4"><h3 className="font-medium">What this does not verify</h3><ul className="mt-2 list-disc space-y-2 pl-5 text-muted-foreground">{limits.map((point, index) => <li key={index}>{point}</li>)}</ul></section>}
    <details className="border-t pt-4"><summary className="cursor-pointer text-xs text-muted-foreground">Technical response</summary>
      <pre className="mt-3 max-h-[55dvh] overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6" tabIndex={0} aria-label={`Saved response for ${label}`}>{text}</pre>
    </details>
  </div>;
}
