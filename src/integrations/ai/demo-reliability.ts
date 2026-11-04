/** Server environment only; never exposed as a browser-controlled bypass. */
export function demoReliabilityMode() { return process.env.DEMO_RELIABILITY_MODE === "true"; }
export function reliabilityBudget(normal: number, demo: number) { return demoReliabilityMode() ? demo : normal; }
export function maxModelAttempts() { return reliabilityBudget(3, 5); }

/** Conservative application ceilings inside the documented model context windows,
 * not claims of provider maximum output. Unknown model overrides are not enlarged.
 * Baseten: https://docs.baseten.co/inference/model-apis/overview
 * Meta: https://dev.meta.ai/docs/models */
export function demoModelLimits(provider: "baseten" | "meta", model: string) {
  if (provider === "baseten" && ["meta-models/muse-spark-open", "meta-models/muse-spark-open-1026"].includes(model))
    return { initialOutput: 16_384, outputCap: 32_768, contextCap: 1_048_576 };
  if (provider === "meta" && ["muse-wonder-1.0", "muse-spark-1.3"].includes(model))
    return { initialOutput: 8192, outputCap: 16_384, contextCap: 1_048_576 };
}
