import { test } from "node:test";
import assert from "node:assert/strict";
import { understandingSummary, repositoryUnderstanding } from "./understanding";
import { generationContextSnapshot } from "./generation-context";
import { serializeProductEvidence } from "../analysis/product-change-evidence";
test("understanding selection and structured output are bounded", () => {
 assert.equal(understandingSummary.safeParse({ purpose: "x".repeat(401) }).success, false);
 assert.equal(understandingSummary.safeParse({ purpose: "Product", audience: "Unknown", terminology: [], workflows: [], surfaces: [], gaps: [], injected: true }).success, false);
});
test("historical context remains valid and advisory understanding stays outside evidence", () => {
 assert.deepEqual(generationContextSnapshot.parse({ repositoryContextUsed: null, runContextUsed: null }), { repositoryContextUsed: null, runContextUsed: null });
 const artifact = repositoryUnderstanding.parse({ schemaVersion: 1, repository: "https://github.com/example/app", sha: "a".repeat(40), analyzedAt: new Date().toISOString(), files: [], summary: { purpose: "Advisory product", audience: "Unknown", terminology: [], workflows: [], surfaces: [], gaps: [] } });
 const bundle = { repository: artifact.repository, base: "b".repeat(40), head: artifact.sha, inventory: [], evidence: [], limited: false, notice: "test" };
 const payload = JSON.parse(serializeProductEvidence(bundle, { repositoryContextUsed: null, runContextUsed: null, repositoryUnderstandingUsed: artifact }));
 assert.deepEqual(payload.evidence, []);
 assert.equal(payload.repositoryUnderstandingAdvisory.summary.purpose, "Advisory product");
 assert.equal(payload.base, bundle.base);
});
test("authority policy separates README prose from executable configuration and runtime", async () => {
 const { understandingAuthorityInstructions } = await import("./understanding-authority");
 assert.match(understandingAuthorityInstructions, /Omit README-only ports, commands and guarantees/);
 assert.match(understandingAuthorityInstructions, /not prose\/comments/);
 assert.match(understandingAuthorityInstructions, /no runtime evidence is supplied/);
});
test("compact model contract is strict and bounded while historical summaries remain readable", async () => {
 const { compactUnderstandingSummary } = await import("./understanding");
 const compact = { purpose: "Track work.", audience: "Teams; builders", terminology: ["Issue: work item"], workflows: ["Create and update issues"], surfaces: ["Issue detail"], gaps: ["Authentication not inspected"] };
 assert.deepEqual(compactUnderstandingSummary.parse(compact), compact);
 for (const invalid of [
  { ...compact, purpose: "x".repeat(241) }, { ...compact, audience: ["Teams"] },
  { ...compact, terminology: ["x".repeat(91)] }, { ...compact, workflows: Array(7).fill("Task") },
  { ...compact, workflows: ["x".repeat(161)] }, { ...compact, surfaces: Array(9).fill("View") },
  { ...compact, surfaces: ["x".repeat(121)] }, { ...compact, gaps: Array(4).fill("Unknown") },
  { ...compact, provenance: "Extra field" },
 ]) assert.equal(compactUnderstandingSummary.safeParse(invalid).success, false);
 assert.ok(understandingSummary.safeParse({ ...compact, purpose: "x".repeat(400), workflows: Array(8).fill("Task") }).success);
});
test("generation JSON schema is smaller, flat and contains only bounded semantics", async () => {
 const { z } = await import("zod");
 const { readFileSync } = await import("node:fs");
 const { compactUnderstandingSummary } = await import("./understanding");
 const before = JSON.parse(readFileSync("src/features/sources/context/fixtures/understanding-generation-schema-before.json", "utf8"));
 const after = z.toJSONSchema(compactUnderstandingSummary);
 assert.ok(JSON.stringify(after).length < JSON.stringify(before).length * 0.8);
 assert.equal(after.additionalProperties, false);
 assert.deepEqual(Object.keys(after.properties ?? {}), ["purpose", "audience", "terminology", "workflows", "surfaces", "gaps"]);
 assert.ok(!JSON.stringify(after).includes('"pattern"'));
 assert.ok(!JSON.stringify(after).includes('"description"'));
 const valid = { purpose: "Track work", audience: "Teams", terminology: [], workflows: [], surfaces: [], gaps: [] };
 for (const key of ["schemaVersion", "sha", "analyzedAt", "files", "repository", "provenance"]) {
  assert.equal(compactUnderstandingSummary.safeParse({ ...valid, [key]: "unexpected" }).success, false);
 }
});
