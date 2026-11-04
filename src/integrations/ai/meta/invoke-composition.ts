import { safeMetaProviderError } from "./provider-error";
import "server-only";
import { assertReliabilityTransport } from "@/integrations/reliability/execution-context";
import { assertInferenceTransport } from "../inference-budget";
import { resolveInference, type ResolvedInference } from "../operation-policy";
import { modelDiagnosticSchema, type ModelDiagnostic, type ModelInvocationMetadata } from "../model-diagnostic";
import { z } from "zod";

export class MetaCompositionError extends Error {
  constructor(public readonly code: string, public readonly retryAfterSeconds?: number, public readonly diagnostic?: ModelDiagnostic) {
    super(`Meta composition request failed: ${code}`);
  }
}

const responseSchema = z.object({
  usage: z.unknown().optional(),
  model: z.string().min(1),
  choices: z.array(z.object({
    finish_reason: z.string(),
    message: z.object({ content: z.string().nullable().optional(), refusal: z.string().nullable().optional() }),
  })).length(1),
});

export async function invokeMetaComposition(options: {
  input: string; schema: Record<string, unknown>; instructions: string; signal?: AbortSignal; settings?: ResolvedInference;
}): Promise<{ text: string; model: string; metadata: ModelInvocationMetadata }> {
  assertReliabilityTransport();
  assertInferenceTransport();
  const key = process.env.META_API_KEY?.trim();
  if (!key) throw new MetaCompositionError("missing-credentials");
  const settings = options.settings ?? resolveInference("meta", "documentation-composition", 4096);
  const model = settings.model;
  const signal = AbortSignal.any([AbortSignal.timeout(120_000), ...(options.signal ? [options.signal] : [])]);
  const started = Date.now();
  let diagnostic: ModelDiagnostic = { kind: "provider-failure", model: model.slice(0, 300) };
  try {
    signal.throwIfAborted();
    const response = await fetch("https://api.meta.ai/v1/chat/completions", {
      method: "POST", redirect: "error", signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: false, max_completion_tokens: settings.maxOutputTokens,
        response_format: { type: "json_schema", json_schema: {
          name: "DocumentationComposition", strict: true, schema: options.schema,
        } }, messages: [
        { role: "developer", content: options.instructions },
        { role: "user", content: options.input },
      ] }),
    });
    if (!response.ok) {
      const code = ({ 400: "invalid-request", 401: "unauthorized", 402: "billing", 403: "forbidden",
        404: "model-unavailable", 413: "invalid-request", 429: "rate-limited" } as Record<number, string>)[response.status] ?? "upstream";
      const retry = response.headers.get("retry-after");
      diagnostic = { ...diagnostic, providerError: await safeMetaProviderError(response) };
      throw new MetaCompositionError(code, retry && /^\d+$/.test(retry) && Number.isSafeInteger(Number(retry)) ? Number(retry) : undefined);
    }
    let envelope: unknown;
    try { envelope = await response.json(); }
    catch { throw new MetaCompositionError(signal.aborted ? (options.signal?.aborted ? "cancelled" : "timeout") : "invalid-response"); }
    const parsed = responseSchema.safeParse(envelope);
    if (!parsed.success) throw new MetaCompositionError("invalid-response");
    const choice = parsed.data.choices[0];
    const completionReason = ["stop", "length", "content_filter", "tool_calls"].includes(choice.finish_reason)
      ? choice.finish_reason as "stop" | "length" | "content_filter" | "tool_calls" : "other";
    const usage = modelDiagnosticSchema.shape.usage.unwrap().strip().safeParse(parsed.data.usage);
    diagnostic = { ...diagnostic, model: parsed.data.model.slice(0, 300), completionReason, ...(usage.success ? { usage: usage.data } : {}), ...(typeof choice.message.content === "string" ? { visibleResponse: { bytes: Buffer.byteLength(choice.message.content), characters: choice.message.content.length } } : {}) };
    if (choice.message.refusal || choice.finish_reason === "content_filter") throw new MetaCompositionError("refused");
    if (choice.finish_reason !== "stop" || typeof choice.message.content !== "string") throw new MetaCompositionError("incomplete-output");
    return { text: choice.message.content, model: parsed.data.model, metadata: { model: diagnostic.model, completionReason, elapsedMs: Date.now() - started, visibleResponse: diagnostic.visibleResponse, ...(usage.success ? { usage: usage.data } : {}) } };
  } catch (error) {
    const code = error instanceof MetaCompositionError ? error.code : signal.aborted ? (options.signal?.aborted ? "cancelled" : "timeout") : "upstream";
    const kind = code === "refused" || code === "incomplete-output" || code === "invalid-response" || code === "cancelled" || code === "timeout" ? code : "provider-failure";
    throw new MetaCompositionError(code, error instanceof MetaCompositionError ? error.retryAfterSeconds : undefined, { ...diagnostic, kind, elapsedMs: Date.now() - started });
  }
}
