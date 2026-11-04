import "server-only";
import { providerErrorSchema } from "../model-diagnostic";
import type { z } from "zod";

/** Read at most 16 KiB; never retain a raw message, rejected value or arbitrary key.
 * Unknown provider vocabulary is withheld rather than merely truncated/redacted. */
export async function safeMetaProviderError(response: Response): Promise<z.infer<typeof providerErrorSchema>> {
  const diagnostic: z.infer<typeof providerErrorSchema> = { httpStatus: response.status, type: null, code: null, parameter: null, message: "Provider error details withheld." };
  const reader = response.body?.getReader();
  if (!reader) return diagnostic;
  try {
    const decoder = new TextDecoder();
    let text = "", bytes = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 16 * 1024) return diagnostic;
      text += decoder.decode(part.value, { stream: true });
    }
    const body: unknown = JSON.parse(text + decoder.decode());
    if (!body || typeof body !== "object" || !("error" in body) || !body.error || typeof body.error !== "object") return diagnostic;
    const error = body.error;
    if ("type" in error) diagnostic.type = providerErrorSchema.shape.type.safeParse(error.type).data ?? null;
    if ("code" in error) diagnostic.code = providerErrorSchema.shape.code.safeParse(error.code).data ?? null;
    if ("param" in error) diagnostic.parameter = providerErrorSchema.shape.parameter.safeParse(error.param).data ?? null;
    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    // Classify public validation failures into fixed messages; never persist echoes.
    if (/\b(?:oneOf|allOf)\b/i.test(message) && /\b(?:strict|not supported|not permitted|not allowed)\b/i.test(message)) diagnostic.message = "Strict JSON schema does not support oneOf or allOf.";
    else if (/\breasoning_effort\b/.test(message) && /\bnone\b/.test(message)) diagnostic.message = "Reasoning effort none is not supported.";
    else if (diagnostic.code === "unsupported_parameter") diagnostic.message = "Request parameter is not supported.";
  } catch { /* Empty, non-JSON, oversized and malformed errors retain status only. */ }
  finally { await reader.cancel().catch(() => {}); }
  return diagnostic;
}
