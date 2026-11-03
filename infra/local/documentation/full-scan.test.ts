import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { noGenerationContext } from "@/features/sources/context/generation-context";
import { validateProductResult } from "@/features/sources/analysis/validate-product-result";

test("Full Scan reads bounded pinned current sources and reuses validated generation without comparing Git", async t => {
  const load = createRequire(import.meta.url), sha = "a".repeat(40);
  const prior = process.env.DOCSYDE_ANALYSIS_REPOSITORIES;
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "example/product";
  const reads: string[] = [];
  let generations = 0;
  const tree = Array.from({ length: 25 }, (_, i) => `src/features/workflow-${i}/actions.ts`);
  const restore: (() => void)[] = [];
  const replacements = [
    ["../../../src/integrations/github/repository-tree.ts", { readRepositoryTree: async (_input: unknown, revision: string) => { assert.equal(revision, sha); return tree; } }],
    ["../../../src/integrations/github/source-reader.ts", { compareCommits: async () => { throw new Error("Snapshot must not compare Git"); } }],
    ["../../../src/features/sources/context/read-source-context.ts", { readPinnedSourceContext: async (input: { commitId: string; paths: string[] }) => {
      assert.equal(input.commitId, sha); assert.ok(input.paths.length <= 4); reads.push(...input.paths);
      return { files: input.paths.map(path => ({ path, contentId: "blob", status: "available", text: "export function save() {}\n" + "// omitted source\n".repeat(200) })), error: null };
    } }],
    ["../../../src/integrations/ai/invocation-log.ts", { validateInvocation: async (_id: unknown, validate: () => unknown) => validate() }],
    ["../../../src/integrations/ai/generate-structured.ts", { generateStructured: async (input: { input: string; instructions: string; invocation: { operation: string } }) => {
      generations++;
      const payload = JSON.parse(input.input);
      assert.equal(payload.mode, "current-state"); assert.equal(payload.base, payload.head);
      assert.equal(payload.evidence.length, 16); assert.equal(payload.runContext, "Focus on saving");
      for (const entry of payload.evidence) { assert.equal(entry.changed, false); assert.equal(entry.side, "head"); assert.ok(entry.lines.map((line: [number, string]) => line[1]).join("\n").length <= 2000); }
      assert.equal(input.invocation.operation, "source-analysis"); assert.match(input.instructions, /CURRENT-STATE SCAN OVERRIDE/);
      return { model: "fixture-no-inference", elapsedMs: 1, data: { findings: [{ kind: "product-behavior", description: "A save function is defined", before: null, after: null, support: "inferred", confidence: "low", confidenceReason: "Caller not supplied", assumptions: [], uncertainties: ["Caller not supplied"], citations: [{ evidenceId: payload.evidence[0].evidenceId, startLine: 1, endLine: 1 }] }], uncertainties: ["Partial source coverage"] } };
    } }],
  ] as const;
  for (const [path, replacement] of replacements) {
    const resolved = load.resolve(path), original = load(resolved), cached = load.cache[resolved]!;
    cached.exports = { ...original, ...replacement }; restore.push(() => { cached.exports = original; });
  }
  t.after(() => { restore.forEach(restore => restore()); if (prior === undefined) delete process.env.DOCSYDE_ANALYSIS_REPOSITORIES; else process.env.DOCSYDE_ANALYSIS_REPOSITORIES = prior; });
  const { analyzeProductChanges }: typeof import("@/features/sources/analysis/analyze-product-changes") = load("../../../src/features/sources/analysis/analyze-product-changes.ts");
  const result = await analyzeProductChanges({ owner: "example", repo: "product", base: sha, head: sha, paths: [] }, { ...noGenerationContext, runContextUsed: "Focus on saving" }, undefined, { currentState: true });
  assert.equal(result.status, "analyzed"); assert.equal(generations, 1); assert.equal(reads.length, 16);
  assert.match(result.bundle.notice, /16 of 25/); assert.equal(validateProductResult(result).bundle.mode, "current-state");
});
