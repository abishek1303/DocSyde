import { z } from "zod";

const paths: Readonly<Record<string, RegExp>> = {
  "runtime-decision": /^(reason|targets\.\d+\.reason)$/,
  "visual-selection": /^selected\.\d+\.question$/,
  "documentation-planning": /^decisions\.\d+\.reason$/,
  "transformation-support": /^verdicts\.\d+\.reason$/,
  "source-analysis": /^findings\.\d+\.(description|confidenceReason)$/,
  "product-impact": /^(summary|(claims\.\d+\.(description|confidenceReason))|(contradictions\.\d+\.description))$/,
};
export const proseLengthIssueSchema = z.object({
  path: z.string().max(100).regex(/^(reason|targets\.\d+\.reason|selected\.\d+\.question|decisions\.\d+\.reason|verdicts\.\d+\.reason|summary|(findings|claims|contradictions)\.\d+\.(description|confidenceReason))$/),
  maximum: z.number().int().positive(), actual: z.number().int().positive(),
}).strict();
export type ProseLengthIssue = z.infer<typeof proseLengthIssueSchema>;

/** Only authored-prose overflow is eligible. Mixed/type/array/reference/refinement
 * failures stay fatal. Feedback includes fixed schema paths and counts, no values. */
export function proseLengthIssues(operation: string, schema: z.ZodType, value: unknown): ProseLengthIssue[] | undefined {
  const permitted = paths[operation];
  if (!permitted) return;
  const parsed = schema.safeParse(value);
  if (parsed.success || parsed.error.issues.length > 8) return;
  const constraints: ProseLengthIssue[] = [];
  for (const issue of parsed.error.issues) {
    const path = issue.path.join(".");
    if (issue.code !== "too_big" || issue.origin !== "string" || !permitted.test(path)
      || typeof issue.maximum !== "number" || !Number.isSafeInteger(issue.maximum) || issue.maximum < 1) return;
    let received: unknown = value;
    for (const key of issue.path) {
      if (received === null || typeof received !== "object" || typeof key === "symbol") return;
      received = Reflect.get(received, key);
    }
    if (typeof received !== "string") return;
    constraints.push({ path, maximum: issue.maximum, actual: received.length });
  }
  return constraints.length ? constraints : undefined;
}

export function proseLengthCorrection(issues: ProseLengthIssue[]) {
  return `\nThe previous response exceeded these authored-text limits: ${JSON.stringify(issues)}. Generate a fresh concise response from the SAME original evidence and schema. Aim well below each maximum. Preserve supported facts, conditions, qualifications and exact references; do not invent, silently truncate, or drop uncertainty to fit. Return only the required JSON.`;
}

/** Only whitespace in explicitly descriptive fields is normalized. Never remove
 * words, sentences, qualifiers, or edit content/reference fields to fit a cap. */
export function normalizeProseWhitespace(operation: string, schema: z.ZodType, value: unknown) {
  const issues = proseLengthIssues(operation, schema, value);
  if (!issues) return { value, normalized: false };
  const copy: unknown = structuredClone(value);
  for (const issue of issues) {
    const keys = issue.path.split(".");
    let parent: unknown = copy;
    for (const key of keys.slice(0, -1)) {
      if (!parent || typeof parent !== "object") return { value, normalized: false };
      parent = Reflect.get(parent, key);
    }
    if (!parent || typeof parent !== "object") return { value, normalized: false };
    const key = keys[keys.length - 1], text: unknown = Reflect.get(parent, key);
    if (typeof text !== "string" || /[`\r\n\t]/.test(text)) return { value, normalized: false };
    // ASCII spaces only: do not rewrite code/newlines or Unicode directionality.
    const compact = text.replace(/ {2,}/g, " ").replace(/^ +| +$/g, "");
    if (compact.length > issue.maximum) return { value, normalized: false };
    Reflect.set(parent, key, compact);
  }
  return schema.safeParse(copy).success ? { value: copy, normalized: true } : { value, normalized: false };
}
