import type { z } from "zod";

/** Lossless cardinality normalization for the source contract's optional strings.
 * Empty/multi-value arrays, nulls and nonstrings remain invalid; no findings are removed. */
export function normalizeSourceOutputShape(operation: string, value: unknown): unknown {
  if (operation !== "source-analysis" || !value || typeof value !== "object" || Array.isArray(value)) return value;
  const root = value as Record<string, unknown>;
  if (!Array.isArray(root.findings)) return value;
  return { ...root, findings: root.findings.map(finding => {
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) return finding;
    const copy = { ...finding } as Record<string, unknown>;
    for (const key of ["audience", "surface"]) {
      const field = copy[key];
      if (Array.isArray(field) && field.length === 1 && typeof field[0] === "string" && field[0].length <= 200) copy[key] = field[0];
    }
    return copy;
  }) };
}

/** All issues must be confined to these descriptive fields. Evidence and mixed
 * failures never enter shape recovery. Feedback contains no rejected values. */
export function sourceShapeCorrection(operation: string, schema: z.ZodType, value: unknown): string | undefined {
  if (operation !== "source-analysis") return;
  const parsed = schema.safeParse(value);
  if (parsed.success || !parsed.error.issues.length) return;
  const issues = parsed.error.issues;
  if (!issues.every(issue => issue.code === "invalid_type" && issue.path.length === 3 && issue.path[0] === "findings" && typeof issue.path[1] === "number" && ["audience", "surface"].includes(String(issue.path[2])))) return;
  const fields = [...new Set(issues.map(issue => String(issue.path[2])))].sort();
  return `\nCorrect findings[].${fields.join(" and findings[].")}: each must be a single string of at most 200 characters, or omitted when not established. Preserve all supported information and findings. Do not select one element from a multi-value array or invent values. Return the complete JSON using the original evidence and exact citations.`;
}
