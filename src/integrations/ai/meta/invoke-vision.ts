import "server-only";
import { z } from "zod";

export class MetaError extends Error {
  constructor(public readonly code: string, public readonly retryAfterSeconds?: number) {
    super(`Meta vision request failed: ${code}`);
  }
}

const responseSchema = z.object({
  model: z.string().min(1),
  choices: z.array(z.object({
    finish_reason: z.string(),
    message: z.object({ content: z.string().nullable().optional(), refusal: z.string().nullable().optional() }),
  })).length(1),
});

export async function invokeMetaVision(options: {
  png: Uint8Array; context: string; instructions: string; signal?: AbortSignal;
}): Promise<{ text: string; model: string }> {
  const key = process.env.META_API_KEY?.trim();
  if (!key) throw new MetaError("missing-credentials");
  const model = process.env.META_VISION_MODEL?.trim() || "muse-spark-1.3";
  const signal = AbortSignal.any([AbortSignal.timeout(120_000), ...(options.signal ? [options.signal] : [])]);
  try {
    signal.throwIfAborted();
    const response = await fetch("https://api.meta.ai/v1/chat/completions", {
      method: "POST", redirect: "error", signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: false, max_completion_tokens: 4096, messages: [
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
    if (choice.message.refusal || choice.finish_reason === "content_filter") throw new MetaError("refused");
    if (choice.finish_reason !== "stop" || typeof choice.message.content !== "string") throw new MetaError("incomplete-output");
    return { text: choice.message.content, model: parsed.data.model };
  } catch (error) {
    if (error instanceof MetaError) throw error;
    throw new MetaError(signal.aborted ? (options.signal?.aborted ? "cancelled" : "timeout") : "upstream");
  }
}
