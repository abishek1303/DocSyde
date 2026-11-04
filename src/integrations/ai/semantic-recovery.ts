import { demoReliabilityMode } from "./demo-reliability";
import { formatRetryAllowed } from "./inference-budget";
import { rejectionDiagnostic } from "./invocation-debug";
import { semanticCorrectionCode, type SemanticCorrection } from "./semantic-correction-policy";

const loggedFailures = new WeakSet<Error>();
export function markSemanticFailureLogged(error: unknown) { if (error instanceof Error) loggedFailures.add(error); }
export function semanticCorrection(error: unknown): SemanticCorrection | undefined {
  if (!demoReliabilityMode() || !formatRetryAllowed() || !(error instanceof Error) || !loggedFailures.has(error)) return;
  const diagnostic = rejectionDiagnostic(error, "grounding-rejection");
  const code = semanticCorrectionCode.safeParse(diagnostic.code);
  if (!code.success) return;
  if (code.data === "unauthorized-reference" && (!diagnostic.reference || !["factRefs", "claimRefs"].includes(diagnostic.reference.category))) return;
  const category = ["missing-or-duplicate-finding", "all-eligible-source-findings-lost", "missing-or-duplicate-generation-entry", "unaddressed-claims"].includes(code.data)
    ? "supported-coverage" : ["unknown-evidence", "unavailable-evidence", "invalid-line-range", "citation-range-mismatch"].includes(code.data) ? "evidence-reference" : "claim-mapping";
  return { category, code: code.data, ...(diagnostic.path ? { path: diagnostic.path } : {}) };
}
export function semanticCorrectionInstructions(feedback: SemanticCorrection) {
  return `\nCORRESPONDENCE CORRECTION: ${JSON.stringify(feedback)}. Regenerate this operation from the SAME original supplied evidence and schema. Use only supplied IDs and valid ranges, preserve supported findings and consistent claim mappings. Recheck all references. Do not invent evidence, behavior, routes or citations, weaken qualifications, hide contradictions, or treat absent runtime evidence as proof. Unsupported content must remain unresolved. Return only the required JSON.`;
}
