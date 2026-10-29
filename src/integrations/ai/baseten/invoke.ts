import "server-only";
import { z } from "zod";

// Provider failures contain no response bodies, prompts, or credentials.
export class BasetenError extends Error {
  constructor(public readonly code: string, public readonly retryAfterSeconds?: number) { super(`Baseten request failed: ${code}`); }
}
const responseSchema = z.object({ choices: z.array(z.object({
  finish_reason: z.string(), message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }),
})).length(1) });
export async function invokeBaseten(options: { instructions: string; input: string; maxOutputTokens: number; signal?: AbortSignal }): Promise<{ text: string; model: string }> {
  const key = process.env.BASETEN_API_KEY?.trim();
  if (!key) throw new BasetenError("missing-credentials");
  const model = process.env.BASETEN_MODEL?.trim() || "meta-models/muse-spark-open-1026";
  const signal = AbortSignal.any([AbortSignal.timeout(120_000), ...(options.signal ? [options.signal] : [])]);
  let response: Response;
  try {
    response = await fetch("https://inference.baseten.co/v1/chat/completions", {
      method: "POST", redirect: "error", signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: false, max_tokens: options.maxOutputTokens, messages: [
        { role: "system", content: options.instructions }, { role: "user", content: options.input },
      ] }),
    });
    if (!response.ok) throw new BasetenError(({ 400: "invalid-request", 401: "unauthorized", 402: "billing", 404: "model-unavailable", 429: "rate-limited" } as Record<number, string>)[response.status] ?? "upstream",
      /^\d+$/.test(response.headers.get("retry-after") ?? "") ? Number(response.headers.get("retry-after")) : undefined);
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) throw new BasetenError("invalid-response");
    const choice = parsed.data.choices[0];
    if (choice.message.refusal) throw new BasetenError("refused");
    if (choice.finish_reason !== "stop" || choice.message.content === null) throw new BasetenError("incomplete-output");
    return { text: choice.message.content, model };
  } catch (error) {
    if (error instanceof BasetenError) throw error;
    throw new BasetenError(signal.aborted ? (options.signal?.aborted ? "cancelled" : "timeout") : "upstream");
  }
}
