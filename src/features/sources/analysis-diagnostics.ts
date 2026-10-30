import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { productChangeOutput, type ProductAnalysis, type ProductBundle } from "./product-change-analysis";
import { ProductAnalysisValidationError, validateProductAnalysis } from "./product-change-evidence";

// Local rejected-run artifacts only. The supplied input is already bounded; never
// accept provider request/response envelopes, credentials, or arbitrary errors here.
export async function validateWithDiagnostics(analysis: ProductAnalysis, bundle: ProductBundle, serializedInput: string): Promise<void> {
  try { validateProductAnalysis(analysis, bundle); }
  catch (error) {
    if (error instanceof ProductAnalysisValidationError) {
      try {
        const modelOutput = productChangeOutput.parse(analysis);
        const suppliedInput: unknown = JSON.parse(serializedInput);
        const directory = join(process.cwd(), ".artifacts", "semantic-analysis-rejections");
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(join(directory, `${randomUUID()}.json`), JSON.stringify({
          capturedAt: new Date().toISOString(), serializedInput, suppliedInput,
          modelOutput, rejection: error.rejection,
        }, null, 2), { flag: "wx", mode: 0o600 });
      } catch {
        // Diagnostic I/O must never change the rejection or trigger a retry.
        console.warn("Rejected semantic-analysis diagnostic could not be retained locally.");
      }
    }
    throw error;
  }
}
