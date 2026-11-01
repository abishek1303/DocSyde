import "server-only";
import { assertReliabilityTransport } from "@/integrations/reliability/execution-context";
import { assertInferenceTransport } from "../inference-budget";
import { resolveInference, type ResolvedInference } from "../operation-policy";
import { modelDiagnosticSchema, type ModelDiagnostic, type ModelInvocationMetadata } from "../model-diagnostic";
import { z } from "zod";
import { visualEvidenceJsonSchema } from "@/integrations/ai/visual-evidence";

export class MetaError extends Error {
  constructor(public readonly code: string, public readonly retryAfterSeconds?: number, public readonly diagnostic?: ModelDiagnostic) {
    super(`Meta vision request failed: ${code}`);
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

export async function invokeMetaVision(options: {
  png: Uint8Array; context: string; instructions: string; signal?: AbortSignal; settings?: ResolvedInference;
}): Promise<{ text: string; model: string; metadata: ModelInvocationMetadata }> {
  assertReliabilityTransport();
  assertInferenceTransport();
  const key = process.env.META_API_KEY?.trim();
  if (!key) throw new MetaError("missing-credentials");
  const settings = options.settings ?? resolveInference("meta", "runtime-vision", 4096);
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
          name: "VisualEvidence", strict: true, schema: visualEvidenceJsonSchema,
        } }, messages: [
        { role: "developer", content: options.instructions },
        { role: "user", content: [
          { type: "text", text: JSON.stringify({ analysisContext: options.context }) },
          { type: "image_url", image_url: { url: `data:image/png;base64,${Buffer.from(options.png.buffer, options.png.byteOffset, options.png.byteLength).toString("base64")}` } },
        ] },
      ] }),
    });
    if (!response.ok) {
      const code = ({ 400: "invalid-request", 401: "unauthorized", 402: "billing", 403: "forbidden",
        404: "model-unavailable", 413: "invalid-request", 429: "rate-limited" } as Record<number, string>)[response.status] ?? "upstream";
      const retry = response.headers.get("retry-after");
      await response.body?.cancel().catch(() => {});
      throw new MetaError(code, retry && /^\d+$/.test(retry) && Number.isSafeInteger(Number(retry)) ? Number(retry) : undefined);
    }
    let envelope: unknown;
    try { envelope = await response.json(); }
    catch { throw new MetaError(signal.aborted ? (options.signal?.aborted ? "cancelled" : "timeout") : "invalid-response"); }
    const parsed = responseSchema.safeParse(envelope);
    if (!parsed.success) throw new MetaError("invalid-response");
    const choice = parsed.data.choices[0];
    const completionReason = ["stop", "length", "content_filter", "tool_calls"].includes(choice.finish_reason)
      ? choice.finish_reason as "stop" | "length" | "content_filter" | "tool_calls" : "other";
    const usage = modelDiagnosticSchema.shape.usage.unwrap().strip().safeParse(parsed.data.usage);
    diagnostic = { ...diagnostic, model: parsed.data.model.slice(0, 300), completionReason, ...(usage.success ? { usage: usage.data } : {}) };
    if (choice.message.refusal || choice.finish_reason === "content_filter") throw new MetaError("refused");
    if (choice.finish_reason !== "stop" || typeof choice.message.content !== "string") throw new MetaError("incomplete-output");
    return { text: choice.message.content, model: parsed.data.model, metadata: { model: diagnostic.model, completionReason, elapsedMs: Date.now() - started, ...(usage.success ? { usage: usage.data } : {}) } };
  } catch (error) {
    const code = error instanceof MetaError ? error.code : signal.aborted ? (options.signal?.aborted ? "cancelled" : "timeout") : "upstream";
    const kind = code === "refused" || code === "incomplete-output" || code === "invalid-response" || code === "cancelled" || code === "timeout" ? code : "provider-failure";
    throw new MetaError(code, error instanceof MetaError ? error.retryAfterSeconds : undefined, { ...diagnostic, kind, elapsedMs: Date.now() - started });
  }
}
