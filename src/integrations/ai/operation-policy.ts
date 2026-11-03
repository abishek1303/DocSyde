import "server-only";
import { z } from "zod";
import { ModelError } from "./structured-output";

// Requested settings only. Null snapshot values mean omitted, never inferred defaults.
const optionsSchema = z.object({
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  temperature: z.number().finite().min(0).max(4).optional(),
  topP: z.number().finite().gt(0).max(1).optional(),
}).strict();
export type InferenceOptions = z.infer<typeof optionsSchema>;
const policies = {
  "repository-discovery": [4096, "repository-discovery-v1"],
  "repository-understanding": [8192, "repository-understanding-v3"],
  "source-analysis": [8192, "source-analysis-v4"],
  "source-summary": [8192, "source-summary-v1"],
  "runtime-decision": [4096, "runtime-decision-v3"],
  "visual-selection": [3072, "visual-selection-v3"],
  "runtime-vision": [4096, "runtime-vision-v2"],
  "product-impact": [8192, "product-impact-v2"],
  "documentation-planning": [4096, "documentation-planning-v3"],
  "documentation-draft": [8192, "documentation-draft-v2"],
  "documentation-transformation": [8192, "documentation-transformation-v2"],
  "transformation-support": [8192, "transformation-support-v2"],
  "receipt-verification": [4096, "receipt-verification-v1"],
} as const;
export type ModelOperation = keyof typeof policies;
// Classification/planning only; other operations retain omitted provider defaults.
const operationInference: Partial<Record<ModelOperation, InferenceOptions>> = {
  "runtime-decision": { reasoningEffort: "low" },
};
function museReasoning(model: string) {
  return ["meta-models/muse-spark-open", "meta-models/muse-spark-open-1026"].includes(model);
}
export function operationPolicy(operation: string) {
  return Object.hasOwn(policies, operation) ? policies[operation as ModelOperation] : undefined;
}
export function configuredModel(provider: "baseten" | "meta") {
  return provider === "baseten" ? process.env.BASETEN_MODEL?.trim() || "meta-models/muse-spark-open-1026"
    : process.env.META_VISION_MODEL?.trim() || "muse-spark-1.3";
}
function checkedOptions(provider: "baseten" | "meta", model: string, raw?: InferenceOptions) {
  const options = optionsSchema.safeParse(raw ?? {});
  if (!options.success) throw new ModelError("unsupported-options");
  // Muse supports top-level effort. Probe the configured hackathon alias directly;
  // sampling controls remain restricted to the separately documented canonical slug.
  if (options.data.reasoningEffort !== undefined && (provider !== "baseten" || !museReasoning(model))) throw new ModelError("unsupported-options");
  if ((options.data.temperature !== undefined || options.data.topP !== undefined)
    && (provider !== "baseten" || model !== "meta-models/muse-spark-open")) throw new ModelError("unsupported-options");
  return options.data;
}
export function resolveInference(provider: "baseten" | "meta", operation: string, maxOutputTokens?: number, raw?: InferenceOptions) {
  const model = configuredModel(provider);
  const max = maxOutputTokens ?? operationPolicy(operation)?.[0] ?? 4096;
  if (!Number.isSafeInteger(max) || max < 1) throw new ModelError("invalid-input");
  const defaults = provider === "baseten" && museReasoning(model) && Object.hasOwn(operationInference, operation)
    ? operationInference[operation as ModelOperation] : undefined;
  return { model, maxOutputTokens: max, ...checkedOptions(provider, model, { ...defaults, ...raw }) };
}
export type ResolvedInference = ReturnType<typeof resolveInference>;
export function inferenceSnapshot(operation: string, settings: ResolvedInference) {
  return { contractVersion: operationPolicy(operation)?.[1] ?? null, maxOutputTokens: settings.maxOutputTokens,
    reasoningEffort: settings.reasoningEffort ?? null, temperature: settings.temperature ?? null, topP: settings.topP ?? null };
}
/** Serialize only confirmed, explicitly requested controls. Never spread arbitrary options. */
export function basetenInferenceFields(settings: ResolvedInference) {
  // Also validate direct transport callers against the same capability gate.
  checkedOptions("baseten", settings.model, {
    ...(settings.reasoningEffort !== undefined ? { reasoningEffort: settings.reasoningEffort } : {}),
    ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
    ...(settings.topP !== undefined ? { topP: settings.topP } : {}),
  });
  return { ...(settings.reasoningEffort !== undefined ? { reasoning_effort: settings.reasoningEffort } : {}),
    ...(settings.temperature !== undefined ? { temperature: settings.temperature } : {}),
    ...(settings.topP !== undefined ? { top_p: settings.topP } : {}) };
}
