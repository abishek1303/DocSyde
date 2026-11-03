import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createRequire } from "node:module";
test("onboarding persists, reopens without inference, refreshes explicitly and isolates failures/repositories", async t => {
 const load = createRequire(import.meta.url), rows = new Map<string, unknown>();
 const originalAllow = process.env.DOCSYDE_ANALYSIS_REPOSITORIES;
 process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "understanding/a,understanding/b";
 let calls = 0, invalid = false, storageFails = false;
 const modelInputs: { files: unknown; productContext?: string }[] = [];
 const replacements = [
  ["../../../src/integrations/database/repository-understandings.ts", { readUnderstanding: async (key: string) => rows.get(key) ?? null, writeUnderstanding: async (key: string, value: unknown) => { if (storageFails) throw new Error("Storage unavailable"); rows.set(key, value); } }],
  ["../../../src/features/sources/context/read-discovered-context.ts", { readDiscoveredContext: async () => ({ discovery: { gaps: [] }, commitId: "a".repeat(40), files: [{ status: "available", path: "README.md", text: "Request tracker" }] }) }],
  ["../../../src/integrations/ai/generate-structured.ts", { generateStructured: async (options: { input: string; schema: z.ZodType; instructions: string; maxOutputTokens: number }) => { calls++;
    modelInputs.push(JSON.parse(options.input));
    const schema = z.toJSONSchema(options.schema);
    assert.deepEqual(Object.keys(schema.properties ?? {}), ["purpose", "audience", "terminology", "workflows", "surfaces", "gaps"]);
    assert.equal(schema.additionalProperties, false);
    assert.equal(options.maxOutputTokens, 8192);
    assert.ok(options.instructions.length < 1500);
    assert.ok(Buffer.byteLength(options.input) <= 32768); return { data: invalid ? { purpose: false } : { purpose: "Request tracker", audience: "Unknown", terminology: [], workflows: [], surfaces: [], gaps: [] } }; } }],
 ] as const;
 const restore: (() => void)[] = [];
 for (const [path, replacement] of replacements) {
  const resolved = load.resolve(path), prior = load(resolved), cached = load.cache[resolved]!;
  cached.exports = { ...prior, ...replacement }; restore.push(() => { cached.exports = prior; });
 }
 t.after(() => { restore.forEach(fn => fn()); if (originalAllow === undefined) delete process.env.DOCSYDE_ANALYSIS_REPOSITORIES; else process.env.DOCSYDE_ANALYSIS_REPOSITORIES = originalAllow; });
 const { getUnderstanding, refreshUnderstanding }: typeof import("@/features/sources/context/understanding-operations") = load("../../../src/features/sources/context/understanding-operations.ts");
 assert.equal(await getUnderstanding("understanding/a"), null);
 const started = Date.now();
 const first = await refreshUnderstanding("understanding/a", "main");
 assert.equal(first.schemaVersion, 1);
 assert.equal(first.repository, "https://github.com/understanding/a");
 assert.equal(first.sha, "a".repeat(40));
 assert.ok(Date.parse(first.analyzedAt) >= started && Date.parse(first.analyzedAt) <= Date.now());
 assert.deepEqual(first.files, [{ path: "README.md", sha256: createHash("sha256").update("Request tracker").digest("hex") }]);
 assert.equal(first.summary.gaps.length, 1);
 assert.match(first.summary.gaps[0], /runtime were not inspected/);
 assert.deepEqual(await getUnderstanding("understanding/a"), first); assert.equal(calls, 1);
 assert.equal(await getUnderstanding("understanding/b"), null);
 await refreshUnderstanding("understanding/a", "main"); assert.equal(calls, 2);
 assert.deepEqual(first.generationContext, { productContextUsed: null });
 const withContext = await refreshUnderstanding("understanding/a", "main", "For support teams");
 assert.deepEqual(withContext.generationContext, { productContextUsed: "For support teams" });
 assert.equal(modelInputs.at(-1)?.productContext, "For support teams");
 assert.ok(!JSON.stringify(modelInputs.at(-1)?.files).includes("For support teams"));
 const blank = await refreshUnderstanding("understanding/a", "main", "  ");
 assert.deepEqual(blank.generationContext, { productContextUsed: null });
 assert.equal(modelInputs.at(-1)?.productContext, undefined);
 const previous = await getUnderstanding("understanding/a"); invalid = true;
 await assert.rejects(() => refreshUnderstanding("understanding/a", "main"));
 assert.deepEqual(await getUnderstanding("understanding/a"), previous);
 invalid = false; storageFails = true;
 await assert.rejects(() => refreshUnderstanding("understanding/a", "main"));
 assert.deepEqual(await getUnderstanding("understanding/a"), previous);
 storageFails = false;
 const historical = { ...first, summary: { ...first.summary, purpose: "x".repeat(400), workflows: Array(8).fill("Historical workflow") } };
 rows.set(first.repository, historical);
 const beforeRead = calls;
 assert.deepEqual(await getUnderstanding("understanding/a"), historical);
 assert.equal(calls, beforeRead);
 await assert.rejects(() => getUnderstanding("other/repository"));
});
