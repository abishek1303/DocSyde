import { inspectionSourceSchema } from "./inspection-decision";
import { validateProductAnalysis } from "./product-change-evidence";

// Preserve existing inspection rejection codes/messages when sharing these checks.
function reject(code: string): never { throw new Error(`Inspection decision rejected: ${code}`); }

export function validateProductResult(source: unknown) {
  const input = inspectionSourceSchema.parse(source);
  if (input.status === "error") reject("upstream-analysis-error");
  const bundle = input.bundle;
  if (new Set(bundle.evidence.map(entry => entry.id)).size !== bundle.evidence.length
    || new Set(bundle.inventory.map(entry => entry.path)).size !== bundle.inventory.length) reject("duplicate-evidence-or-path");
  if (bundle.inventory.some(file => !bundle.evidence.some(entry => entry.side === "patch" && entry.path === file.path))) reject("incomplete-change-inventory");
  for (const entry of bundle.evidence) {
    if (entry.commitId !== (entry.side === "patch" ? null : bundle[entry.side])) reject("unpinned-evidence");
    const changed = bundle.inventory.some(file => file.path === entry.path || file.previousPath === entry.path);
    if (entry.changed !== changed) reject("contradictory-change-evidence");
    if (entry.side === "patch") {
      if (!changed || !["included", "empty", "unavailable", "over-budget"].includes(entry.status)
        || ((entry.text === null) !== ["unavailable", "over-budget"].includes(entry.status))
        || (entry.status === "empty" && entry.text !== "")) reject("inconsistent-patch-evidence");
    } else if ((entry.text !== null) !== (entry.status === "available")) reject("inconsistent-source-evidence");
    if (entry.text === null && entry.status !== "expected-absent" && !bundle.limited) reject("contradictory-coverage");
  }
  if (input.analysis) validateProductAnalysis(input.analysis, bundle);
  if (input.status === "no-change") {
    if (bundle.inventory.length || input.analysis !== null || bundle.evidence.some(entry => entry.changed) || bundle.limited
      || input.error || input.rejection) reject("contradictory-no-change");
    return input;
  }
  if (!bundle.inventory.length || input.error || input.rejection
    || (input.status === "analyzed" && (!input.analysis || input.analysis.assessment === "insufficient-evidence"))
    || (input.status === "insufficient-evidence" && input.analysis && input.analysis.assessment !== "insufficient-evidence")) reject("inconsistent-source-result");
  return input;
}
