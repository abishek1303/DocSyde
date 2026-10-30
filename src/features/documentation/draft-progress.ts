import type { SourceStep } from "@/features/sources/product-analysis";
export type DraftStep = "prepare-context" | SourceStep | "propose-documentation" | "validate-draft";
export type DraftProgress = (event: { step: DraftStep; status: "running" | "completed" | "failed"; summary: string }) => Promise<void>;
