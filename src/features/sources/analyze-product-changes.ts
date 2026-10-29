import "server-only";
import { compareCommits, repositoryPathInput } from "@/integrations/github/source-reader";
import { generateStructured, ModelError } from "@/integrations/ai/generate-structured";
import { assertAllowedRepository, withSourceAccess } from "./local-source-access";
import { readPinnedSourceContext } from "./read-source-context";
import { selectEvidence } from "./summary-evidence";
import { productChangeInput, productChangeOutput, type ProductBundle, type ProductResult } from "./product-change-analysis";
import { serializeProductEvidence, validateProductAnalysis, ProductAnalysisValidationError } from "./product-change-evidence";
import { productChangeInstructions } from "./product-change-prompt";
import { PRODUCT_CHANGE_OUTPUT_TOKENS } from "./product-change-limits";
export async function analyzeProductChanges(raw: unknown): Promise<ProductResult> {
  const input = productChangeInput.parse(raw);
  const paths = [...new Set(input.paths.map(path => repositoryPathInput.parse(path)))];
  assertAllowedRepository(input.owner, input.repo);
  return withSourceAccess(async () => {
    const deadline = AbortSignal.timeout(180_000);
    const signal = AbortSignal.any([deadline, AbortSignal.timeout(60_000)]);
    const comparison = await compareCommits(input, { maxCommits: 100, signal });
    const selected = selectEvidence(comparison);
    const bundle: ProductBundle = { repository: comparison.repository.location, base: comparison.base.commitId, head: comparison.head.commitId,
      inventory: comparison.files.map(({ path, previousPath, kind }) => ({ path, previousPath, kind })),
      evidence: selected.files.map(file => ({ id: `patch-${file.id}`, path: file.path, side: "patch", commitId: null, text: file.patch, status: file.coverage, changed: true })),
      limited: selected.limited, notice: "Selected context only. Supplied patches may be incomplete. Runtime behavior, deployment and tests are unverified." };
    if (!comparison.files.length) return { bundle, bytes: Buffer.byteLength(serializeProductEvidence(bundle)), status: "no-change", analysis: null };
    // Sequential endpoint batches preserve the existing two-read concurrency ceiling.
    for (const side of ["base", "head"] as const) {
      const requested: string[] = [];
      for (const path of paths) {
        const change = comparison.files.find(f => f.path === path || f.previousPath === path);
        const actual = side === "base" ? change?.previousPath ?? change?.path ?? path : change?.path ?? path;
        if ((side === "base" && change?.kind === "added") || (side === "head" && change?.kind === "deleted")) {
          bundle.evidence.push({ id: `${side}-${bundle.evidence.length}`, path: actual, side, commitId: bundle[side], text: null, status: "expected-absent", changed: true });
        } else requested.push(actual);
      }
      if (!requested.length) continue;
      const context = await readPinnedSourceContext({ owner: input.owner, repo: input.repo, revision: bundle[side], commitId: bundle[side], paths: [...new Set(requested)] }, signal);
      if (context.error) throw new Error(context.error);
      bundle.limited ||= !context.complete;
      for (const file of context.files) bundle.evidence.push({ id: `${side}-${bundle.evidence.length}`, path: file.path, side, commitId: bundle[side], contentId: file.contentId,
        text: file.status === "available" ? file.text : null, status: file.status === "available" ? "available" : `${file.status}: ${file.reason}`, changed: comparison.files.some(f => f.path === file.path || f.previousPath === file.path) });
    }
    const payload = serializeProductEvidence(bundle);
    const result: ProductResult = { bundle, bytes: Buffer.byteLength(payload, "utf8"), status: "insufficient-evidence", analysis: null };
    if (!bundle.evidence.some(e => e.changed && e.text)) return result;
    try {
      const generated = await generateStructured({ instructions: productChangeInstructions, input: payload, schema: productChangeOutput, maxOutputTokens: PRODUCT_CHANGE_OUTPUT_TOKENS, signal: deadline });
      validateProductAnalysis(generated.data, bundle);
      return { ...result, status: generated.data.assessment === "insufficient-evidence" ? "insufficient-evidence" : "analyzed", analysis: generated.data, model: generated.model, elapsedMs: generated.elapsedMs };
    } catch (error) {
      const rejection = error instanceof ModelError ? { stage: "model-output" as const, code: error.code } : error instanceof ProductAnalysisValidationError ? error.rejection : undefined;
      return { ...result, status: "error", ...(rejection ? { rejection } : {}), error: rejection ? `Semantic analysis rejected (${rejection.stage}: ${rejection.code}). Draft generation must be skipped. Retry manually.` : "Semantic analysis validation failed. Retry manually." };
    }
  });
}
