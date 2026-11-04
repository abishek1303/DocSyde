import { responseTextMetrics } from "../response-text-metrics";
import "server-only";
import { assertReliabilityTransport } from "@/integrations/reliability/execution-context";
import { assertInferenceTransport } from "../inference-budget";
import { basetenInferenceFields, resolveInference, type ResolvedInference } from "../operation-policy";
import type { BasetenResponseFormat } from "./structured-output";
import { z } from "zod";

// Provider failures contain no response bodies, prompts, or credentials.
import { modelDiagnosticSchema, type ModelDiagnostic, type ModelInvocationMetadata } from "../model-diagnostic";

export class BasetenError extends Error {
  constructor(public readonly code: string, public readonly retryAfterSeconds?: number, public readonly diagnostic?: ModelDiagnostic) { super(`Baseten request failed: ${code}`); }
}
const responseSchema = z.object({ choices: z.array(z.object({
  finish_reason: z.string(), message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }),
})).length(1), usage: z.unknown().optional() });
export async function invokeBaseten(options: { instructions: string; input: string; maxOutputTokens: number; signal?: AbortSignal; settings?: ResolvedInference; responseFormat?: BasetenResponseFormat }): Promise<{ text: string; model: string; metadata: ModelInvocationMetadata }> {
  assertReliabilityTransport();
  assertInferenceTransport();
  const key = process.env.BASETEN_API_KEY?.trim();
  if (!key) throw new BasetenError("missing-credentials");
  const settings = options.settings ?? resolveInference("baseten", "transport", options.maxOutputTokens);
  const model = settings.model;
  const fields = basetenInferenceFields(settings);
  const signal = AbortSignal.any([AbortSignal.timeout(120_000), ...(options.signal ? [options.signal] : [])]);
  const started = Date.now();
  let diagnostic: ModelDiagnostic = { kind: "provider-failure", model: model.slice(0, 300), reasoningEffort: settings.reasoningEffort ?? null };
  let response: Response;
  try {
    response = await fetch("https://inference.baseten.co/v1/chat/completions", {
      method: "POST", redirect: "error", signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: false, max_tokens: settings.maxOutputTokens, ...fields, ...(options.responseFormat ? { response_format: options.responseFormat } : {}), messages: [
        { role: "system", content: options.instructions }, { role: "user", content: options.input },
      ] }),
    });
    if (!response.ok) throw new BasetenError(({ 400: "invalid-request", 401: "unauthorized", 402: "billing", 404: "model-unavailable", 429: "rate-limited" } as Record<number, string>)[response.status] ?? "upstream",
      /^\d+$/.test(response.headers.get("retry-after") ?? "") ? Number(response.headers.get("retry-after")) : undefined);
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) throw new BasetenError("invalid-response", undefined, { ...diagnostic, kind: "invalid-response", issues: parsed.error.issues.slice(0, 8).map(issue => ({ code: issue.code, path: issue.path.map(part => typeof part === "number" ? "[]" : ["choices", "finish_reason", "message", "content", "refusal", "usage", "prompt_tokens", "completion_tokens", "total_tokens"].includes(String(part)) ? String(part) : "[unknown]").join(".") })) });
    const choice = parsed.data.choices[0];
    const completionReason = ["stop", "length", "content_filter", "tool_calls"].includes(choice.finish_reason) ? choice.finish_reason as "stop" | "length" | "content_filter" | "tool_calls" : "other";
    const usage = modelDiagnosticSchema.shape.usage.unwrap().strip().safeParse(parsed.data.usage);
    diagnostic = { ...diagnostic, completionReason, ...(usage.success ? { usage: usage.data } : {}),
      // Measure only visible content, even on truncation. Never retain reasoning fields.
      ...(choice.message.content !== null ? { visibleResponse: responseTextMetrics(choice.message.content) } : {}),
    };
    if (choice.message.refusal) throw new BasetenError("refused");
    if (choice.finish_reason !== "stop" || choice.message.content === null) throw new BasetenError("incomplete-output");
    return { text: choice.message.content, model, metadata: { model, completionReason, elapsedMs: Date.now() - started, reasoningEffort: diagnostic.reasoningEffort, visibleResponse: diagnostic.visibleResponse, ...(usage.success ? { usage: usage.data } : {}) } };
  } catch (error) {
    if (error instanceof BasetenError) {
      const kind = ["incomplete-output", "invalid-response", "refused"].includes(error.code) ? error.code as "incomplete-output" | "invalid-response" | "refused" : "provider-failure";
      throw new BasetenError(error.code, error.retryAfterSeconds, { ...diagnostic, ...error.diagnostic, kind, elapsedMs: Date.now() - started });
    }
    const code = signal.aborted ? (options.signal?.aborted ? "cancelled" : "timeout") : "upstream";
    throw new BasetenError(code, undefined, { ...diagnostic, kind: code === "upstream" ? "provider-failure" : code, elapsedMs: Date.now() - started });
  }
}
