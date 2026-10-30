import "server-only";
import { z } from "zod";
import { BasetenError } from "./invoke";

const dollars = z.union([z.number(), z.string().regex(/^[+-]?\d+(\.\d+)?$/)])
  .transform(Number).pipe(z.number().finite());
const usage = z.object({ total: dollars, credits_used: dollars, subtotal: dollars });
const summary = z.object({
  dedicated_usage: usage.nullish(),
  training_usage: usage.nullish(),
  model_apis_usage: usage.nullish(),
});

/** Organization-wide usage, not a per-key balance or finalized invoice. */
export async function getBasetenBilling(options: { startDate: string; endDate: string; startingCreditsUsd?: number }) {
  const dates = z.object({ startDate: z.iso.datetime({ offset: true }), endDate: z.iso.datetime({ offset: true }), startingCreditsUsd: z.number().finite().nonnegative().optional() }).safeParse(options);
  if (!dates.success) throw new BasetenError("invalid-date-range");
  const start = Date.parse(options.startDate);
  const end = Date.parse(options.endDate);
  if (start < Date.parse("2026-01-01T00:00:00Z") || end <= start || end - start > 31 * 86_400_000) {
    throw new BasetenError("invalid-date-range");
  }
  const key = process.env.BASETEN_API_KEY?.trim();
  if (!key) throw new BasetenError("missing-credentials");
  const url = new URL("https://api.baseten.co/v1/billing/usage_summary");
  url.searchParams.set("start_date", options.startDate);
  url.searchParams.set("end_date", options.endDate);
  const signal = AbortSignal.timeout(20_000);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store", redirect: "error", signal,
    });
    if (!response.ok) throw new BasetenError(`billing-http-${response.status}`);
    const parsed = summary.safeParse(await response.json());
    if (!parsed.success) throw new BasetenError("invalid-billing-response");
    const categories = {
      dedicated: parsed.data.dedicated_usage ?? null,
      training: parsed.data.training_usage ?? null,
      modelApis: parsed.data.model_apis_usage ?? null,
    };
    const available = Object.values(categories).filter((value) => value !== null);
    const grossCost = available.length ? available.reduce((sum, value) => sum + value.total, 0) : null;
    return {
      currency: "USD" as const, ...options, categories,
      grossCost,
      creditsUsed: available.length ? available.reduce((sum, value) => sum + value.credits_used, 0) : null,
      costAfterCredits: available.length ? available.reduce((sum, value) => sum + value.subtotal, 0) : null,
      remainingCredits: null,
      estimatedRemainingCredits: options.startingCreditsUsd !== undefined && grossCost !== null
        ? Math.max(0, options.startingCreditsUsd - grossCost) : null,
      estimateAssumption: "Starting credits minus gross cost in this range; assumes the range covers all usage against the grant, with no expiry, other charges, or additional grants. Usage may lag.",
      remainingCreditsReason: "Baseten's public billing API does not expose the remaining credit balance. Check the workspace Billing page.",
    };
  } catch (error) {
    if (error instanceof BasetenError) throw error;
    throw new BasetenError(signal.aborted ? "billing-timeout" : "billing-upstream");
  }
}
