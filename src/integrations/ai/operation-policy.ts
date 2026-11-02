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
  "source-analysis": [8192, "source-analysis-v3"],
  "source-summary": [8192, "source-summary-v1"],
  "runtime-decision": [4096, "runtime-decision-v2"],
  "visual-selection": [3072, "visual-selection-v3"],
  "runtime-vision": [4096, "runtime-vision-v2"],
  "product-impact": [8192, "product-impact-v2"],
  "documentation-planning": [4096, "documentation-planning-v2"],
  "documentation-draft": [8192, "documentation-draft-v2"],
  "documentation-transformation": [8192, "documentation-transformation-v2"],
  "transformation-support": [8192, "transformation-support-v2"],
  "receipt-verification": [4096, "receipt-verification-v1"],
} as const;
export type ModelOperation = keyof typeof policies;
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
  // Baseten's detailed Muse table documents controls for the canonical slug, but
  // not the hackathon -1026 alias. Never infer equivalence or silently change models.
  // https://docs.baseten.co/inference/model-apis/reasoning
  // https://docs.baseten.co/reference/inference-api/chat-completions
  if (Object.values(options.data).some(value => value !== undefined) && (provider !== "baseten" || model !== "meta-models/muse-spark-open")) {
    throw new ModelError("unsupported-options");
  }
  return options.data;
}
export function resolveInference(provider: "baseten" | "meta", operation: string, maxOutputTokens?: number, raw?: InferenceOptions) {
  const model = configuredModel(provider);
  const max = maxOutputTokens ?? operationPolicy(operation)?.[0] ?? 4096;
  if (!Number.isSafeInteger(max) || max < 1) throw new ModelError("invalid-input");
  return { model, maxOutputTokens: max, ...checkedOptions(provider, model, raw) };
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
