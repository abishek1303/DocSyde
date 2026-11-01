import { test } from "node:test";
import assert from "node:assert/strict";
import { assertReliabilityInventory, type ReliabilityManifest } from "@/features/documentation/runs/reliability-baseline";

const sha = "0".repeat(64);
function fixture() {
  const inventory = { databaseName: "docsyde_reliability_test_a", documents: [{ id: "a", sha256: sha, projectionSha256: sha }],
    publications: [{ id: "p", repository: "repo", route: "/requests", documentId: "a", publishedAt: "time" }], schemaFingerprintVersion: 2 as const, schemaSha256: sha, contextSha256: sha };
  // Only the comparison's actual inputs are needed; construct the full typed baseline separately.
  const baseline: ReliabilityManifest = { version: 2, experimentId: "test", runtimeIdentity: { version: 1, experimentId: "test", scenario: "A", docsydeSha: "2".repeat(40), requestDeskSha: "1".repeat(40), buildSha256: sha, workflowVersion: "1", runtimeVersion: "request-desk-reliability-v1" }, scenario: "A", databaseName: inventory.databaseName, head: "1".repeat(40), branch: "reliability/A", runContext: null,
    runtime: { path: "runtime", sha256: sha }, runtimeDescriptor: { id: "runtime", version: "1", sha256: sha, capabilitiesSha256: sha }, representativeBatchCheck: { path: "batch", sha256: sha }, offlineGate: { path: "offline", sha256: sha }, githubGate: { path: "github", sha256: sha },
    baseline: { version: 1, specificationVersion: 2, experimentId: "test", runtimePolicySha256: sha, sourceDatabase: "original", docsydeSha: "2".repeat(40), requestDeskBase: "45799b2fae07f1326296b8ba85fae51476fd153d", repository: "https://github.com/abishek1303/docsyde", serverIdentity: sha,
      code: [{ path: "code", sha256: sha }], inference: {}, environment: {}, documents: structuredClone(inventory.documents), publications: structuredClone(inventory.publications),
      contextSha256: sha, schemaFingerprintVersion: 2 as const, schemaSha256: sha, runContext: null } };
  return { inventory, baseline };
}
test("only identical complete corpus/context/schema/publications in the isolated database admit a scenario", () => {
  const { inventory, baseline } = fixture();
  assert.doesNotThrow(() => assertReliabilityInventory(baseline, inventory));
  for (const mutate of [
    (value: typeof inventory) => { value.databaseName = "original"; },
    (value: typeof inventory) => { value.documents.push({ id: "previous-scenario", sha256: sha, projectionSha256: sha }); },
    (value: typeof inventory) => { value.documents[0].sha256 = "1".repeat(64); },
    (value: typeof inventory) => { value.documents[0].projectionSha256 = "1".repeat(64); },
    (value: typeof inventory) => { value.contextSha256 = "1".repeat(64); },
    (value: typeof inventory) => { value.schemaSha256 = "1".repeat(64); },
    (value: typeof inventory) => { value.publications[0].documentId = "previous-scenario"; },
  ]) { const changed = structuredClone(inventory); mutate(changed); assert.throws(() => assertReliabilityInventory(baseline, changed)); }
});

test("an old fingerprint version cannot admit a v2 baseline", () => {
  const { inventory, baseline } = fixture();
  assert.throws(() => assertReliabilityInventory(baseline, { ...inventory, schemaFingerprintVersion: 1 } as unknown as typeof inventory), /version mismatch/);
});
