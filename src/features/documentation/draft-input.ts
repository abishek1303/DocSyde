import { randomUUID } from "node:crypto";
import { z } from "zod";
import { productChangeOutput, validateProductAnalysis, type ProductResult } from "@/features/sources/product-analysis";
import { associationChoice, type AssociationChoice, type DraftFacts } from "./document";
import { DOCUMENTATION_DRAFT_INPUT_BUDGET_BYTES } from "./draft-limits";
export function prepareDraftInput(result: ProductResult, supplied: AssociationChoice[] = []): DraftFacts | null {
  if (result.status === "error" || result.status === "no-change" || !result.analysis) return null;
  const analysis = productChangeOutput.parse(result.analysis);
  validateProductAnalysis(analysis, result.bundle);
  const analysisId = randomUUID();
  const findings = analysis.findings.map((finding, index) => ({ id: `finding-${index + 1}`, kind: finding.kind, description: finding.description, before: finding.before, after: finding.after,
    qualifications: { support: finding.support, confidence: finding.confidence, confidenceReason: finding.confidenceReason, assumptions: finding.assumptions, uncertainties: finding.uncertainties }, citations: finding.citations }));
  const facts = findings.filter(f => f.kind !== "undetermined").flatMap(finding => (["description", "before", "after"] as const).flatMap(field => finding[field] ? [{ id: `${finding.id}-${field}`, findingRef: finding.id, field, value: finding[field]!, qualifications: finding.qualifications }] : []));
  if (!facts.length) return null;
  const context = z.array(associationChoice).max(20).parse(supplied).map(choice => {
    if (choice.origin !== "operator" || choice.findingRef) throw new Error("Operator context cannot claim finding provenance.");
    if (choice.kind === "route" && (!choice.value.startsWith("/") || choice.value.startsWith("//") || /[?#\x00-\x20]/.test(choice.value))) throw new Error("Routes must be plain pathnames.");
    return choice;
  });
  if (new Set(context.map(c => c.id)).size !== context.length) throw new Error("Association IDs must be unique.");
  analysis.findings.forEach((f, i) => {
    if (f.audience) context.push({ id: `analysis-audience-${i + 1}`, kind: "audience", value: f.audience, origin: "finding", findingRef: findings[i].id });
    if (f.surface) context.push({ id: `analysis-surface-${i + 1}`, kind: "ui-surface", value: f.surface, origin: "finding", findingRef: findings[i].id });
  });
  if (new Set(context.map(c => c.id)).size !== context.length) throw new Error("Association IDs collide with analysis context.");
  const citedIds = new Set(findings.flatMap(f => f.citations.map(c => c.evidenceId)));
  return { facts, context, provenance: { analysisId, repository: result.bundle.repository, base: result.bundle.base, head: result.bundle.head, assessment: analysis.assessment, limited: result.bundle.limited,
    limitations: [...new Set([result.bundle.notice, ...analysis.uncertainties])], facts, findings,
    evidence: result.bundle.evidence.filter(e => citedIds.has(e.id)).map(e => ({ id: e.id, path: e.path, side: e.side, commitId: e.commitId, contentId: e.contentId ?? null })) } };
}
export function serializeDraftInput(input: DraftFacts): string {
  // Provenance is assembled by the server; the model only needs allowed facts,
  // association choices and limitations, not duplicated evidence snapshots.
  const payload = JSON.stringify({ facts: input.facts, context: input.context, assessment: input.provenance.assessment, limited: input.provenance.limited, limitations: input.provenance.limitations });
  if (Buffer.byteLength(payload, "utf8") > DOCUMENTATION_DRAFT_INPUT_BUDGET_BYTES) throw new Error("Draft input exceeds 32 KiB; reduce the upstream selection. Nothing was omitted.");
  return payload;
}
