export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && (process.env.DOCSYDE_RELIABILITY_CONTEXT || process.env.DOCSYDE_RELIABILITY_MANIFEST)) {
    const { preflightReliabilityProcess } = await import("@/features/documentation/runs/reliability-baseline");
    await preflightReliabilityProcess();
  }
}
