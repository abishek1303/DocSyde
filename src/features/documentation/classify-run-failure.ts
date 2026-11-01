import "server-only";
import { ZodError } from "zod";
import { SourceReadError } from "@/integrations/github/errors";
import { ModelError } from "@/integrations/ai/structured-output";
import { ProductEvidenceBudgetError } from "@/features/sources/product-analysis";
import type { RunFailure, RunFailureCode } from "./run-failure";

const modelCodes: Record<string, RunFailureCode> = {
  "missing-credentials": "model-credentials", unauthorized: "model-access", forbidden: "model-access", billing: "model-billing", "rate-limited": "model-rate-limit", timeout: "model-timeout", "model-unavailable": "model-unavailable", "invalid-json": "model-output", "schema-mismatch": "model-output", "incomplete-output": "model-output", "invalid-response": "model-output", refused: "model-output",
};
export function modelFailureCode(code: string): RunFailureCode { return Object.hasOwn(modelCodes, code) ? modelCodes[code] : "model-failed"; }
export function classifyRunFailure(stage: string, error: unknown): RunFailure {
  if (error instanceof SourceReadError) {
    const codes: Record<SourceReadError["code"], RunFailureCode> = {
      "missing-credentials": "source-credentials", unauthorized: "source-access", forbidden: "source-access", "not-found": "source-not-found", "rate-limited": "source-rate-limit", timeout: "source-timeout", "unsupported-comparison": "source-history", "incomplete-evidence": "source-incomplete", "invalid-input": "source-input", upstream: "source-unavailable",
    };
    return { stage, code: Object.hasOwn(codes, error.code) ? codes[error.code] : "source-unavailable" };
  }
  if (error instanceof ModelError) return { stage, code: modelFailureCode(error.code) };
  if (error instanceof ProductEvidenceBudgetError) return { stage, code: "evidence-budget" };
  if (error instanceof ZodError) return { stage, code: "invalid-data" };
  // Database wrappers preserve a typed cause. Inspect only known codes, never
  // query text, messages, stack traces, response bodies or arbitrary properties.
  if (["prepare-context", "documentation-planning", "proposal-retention"].includes(stage)) {
    let current = error;
    for (let depth = 0; current instanceof Error && depth < 4; depth++, current = current.cause) {
      const code = "code" in current ? current.code : null;
      if (code === "42P01" || code === "42703" || code === "3F000") return { stage, code: "database-schema" };
      if (typeof code === "string" && ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EPERM", "28P01", "3D000", "08006", "57P01"].includes(code)) return { stage, code: "database-unavailable" };
    }
  }
  return { stage, code: stage === "runtime-inspection" ? "runtime-failed" : "stage-failed" };
}
