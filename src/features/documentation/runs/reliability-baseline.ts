import "server-only";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { readCleanCheckoutIdentity } from "@/integrations/local-git/checkout-identity";
import { readReliabilityInventory } from "@/integrations/database/reliability-inventory";
import { inferenceSnapshot, resolveInference } from "@/integrations/ai/operation-policy";
import { withInferenceBudget, type FrozenInference } from "@/integrations/ai/inference-budget";
import { documentationHash } from "../documents/document-identity";
import { validateDocumentationDocument } from "../documents/document-validation";
import { projectSectionContexts } from "../documents/section-context";
import type { runInput } from "./run-record";
import { loadRunRuntimeConfig, runRuntimeConfigSchema } from "./run-runtime-config";

export const RELIABILITY_BASE = "45799b2fae07f1326296b8ba85fae51476fd153d";
const hash = z.string().regex(/^[a-f0-9]{64}$/), sha = z.string().regex(/^[a-f0-9]{40}$/);
export const fileReceiptSchema = z.object({ path: z.string().min(1), sha256: hash }).strict();
const inference = z.object({ provider: z.enum(["baseten", "meta"]), model: z.string(), config: z.object({
  contractVersion: z.string().nullable(), maxOutputTokens: z.number().int().positive(), reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).nullable(), temperature: z.number().nullable(), topP: z.number().nullable(),
}).strict() }).strict();
export const reliabilityBaselineSchema = z.object({
  version: z.literal(1), docsydeSha: sha, requestDeskBase: z.literal(RELIABILITY_BASE), repository: z.literal("https://github.com/abishek1303/docsyde"),
  sourceDatabase: z.string(), serverIdentity: hash, code: z.array(fileReceiptSchema).min(1),
  inference: z.record(z.string(), inference), environment: z.record(z.string(), z.string().nullable()),
  documents: z.array(z.object({ id: z.uuid(), sha256: hash, projectionSha256: hash }).strict()),
  publications: z.array(z.object({ id: z.uuid(), repository: z.string(), route: z.string(), documentId: z.uuid(), publishedAt: z.string() }).strict()),
  contextSha256: hash, schemaSha256: hash, runContext: z.null(),
}).strict();
export const reliabilityManifestSchema = z.object({
  version: z.literal(1), scenario: z.enum(["A", "B", "C"]), baseline: reliabilityBaselineSchema,
  databaseName: z.string().regex(/^docsyde_reliability_[a-z0-9_]+$/), head: sha, branch: z.string().min(1),
  runContext: z.string().max(300).nullable(), runtime: fileReceiptSchema,
  runtimeDescriptor: z.object({ id: z.string(), version: z.string(), sha256: hash, capabilitiesSha256: hash }).strict(),
  representativeBatchCheck: fileReceiptSchema, offlineGate: fileReceiptSchema, githubGate: fileReceiptSchema,
}).strict();
export type ReliabilityManifest = z.infer<typeof reliabilityManifestSchema>;
export function bytesHash(bytes: string | Uint8Array) { return createHash("sha256").update(bytes).digest("hex"); }
export async function fileReceipt(path: string) { return { path: resolve(path), sha256: bytesHash(await readFile(path)) }; }
export async function verifyFile(receipt: z.infer<typeof fileReceiptSchema>) {
  if ((await fileReceipt(receipt.path)).sha256 !== receipt.sha256) throw new Error("Reliability evidence/configuration drift.");
}
export function baselineInference(): Record<string, FrozenInference> {
  return Object.fromEntries(["source-analysis", "runtime-decision", "visual-selection", "runtime-vision", "product-impact", "documentation-planning", "documentation-transformation", "transformation-support"].map(operation => {
    const provider = operation === "runtime-vision" ? "meta" : "baseten", settings = resolveInference(provider, operation);
    return [operation, { provider, model: settings.model, config: inferenceSnapshot(operation, settings) }];
  }));
}
export function baselineEnvironment() {
  return Object.fromEntries(["DOCSYDE_HOST_ORIGIN", "DOCSYDE_STORAGE_DIRECTORY", "DOCSYDE_REPOSITORY_OWNER", "DOCSYDE_REPOSITORY_NAME", "DOCSYDE_DELIVERY_ENDPOINT", "GITHUB_REPOSITORY", "DOCSYDE_ANALYSIS_REPOSITORIES"].map(key => [key, process.env[key] ?? null]).concat([["node", process.version], ["NODE_ENV", process.env.NODE_ENV ?? "development"], ["basetenCredentialConfigured", String(Boolean(process.env.BASETEN_API_KEY))], ["metaCredentialConfigured", String(Boolean(process.env.META_API_KEY))]]));
}
export function databaseServerIdentity() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  // Hash non-secret connection coordinates; passwords and URL query options are never retained.
  return documentationHash({ protocol: url.protocol, host: url.hostname, port: url.port || "5432", user: url.username });
}
export async function baselineInventory(repository: string) {
  const inventory = await readReliabilityInventory(repository);
  return { databaseName: inventory.databaseName, documents: inventory.documents.map(({ id, document }) => {
    const canonical = validateDocumentationDocument(document);
    if (canonical.id !== id) throw new Error("Saved document identity mismatch.");
    return { id, sha256: documentationHash(canonical), projectionSha256: documentationHash(projectSectionContexts(canonical)) };
  }), publications: inventory.publications, schemaSha256: documentationHash({ columns: inventory.schema, constraints: inventory.constraints }), contextSha256: documentationHash(inventory.context) };
}
export function assertReliabilityInventory(manifest: ReliabilityManifest, current: Awaited<ReturnType<typeof baselineInventory>>) {
  const { baseline } = manifest;
  if (current.databaseName === baseline.sourceDatabase) throw new Error("Reliability database must be isolated.");
  if (current.databaseName !== manifest.databaseName || !isDeepStrictEqual(current.documents, baseline.documents)
    || !isDeepStrictEqual(current.publications, baseline.publications) || current.contextSha256 !== baseline.contextSha256 || current.schemaSha256 !== baseline.schemaSha256) throw new Error("Reliability baseline corpus/publication/context mismatch.");
}
export async function assertReliabilityBaseline(manifest: ReliabilityManifest) {
  const { baseline } = manifest;
  if (manifest.runContext !== baseline.runContext) throw new Error("Reliability run-context drift.");
  if ((await readCleanCheckoutIdentity(process.cwd())).sha !== baseline.docsydeSha) throw new Error("Reliability DocSyde revision mismatch.");
  if (manifest.databaseName === baseline.sourceDatabase || databaseServerIdentity() !== baseline.serverIdentity) throw new Error("Reliability database isolation mismatch.");
  const current = await baselineInventory(baseline.repository);
  assertReliabilityInventory(manifest, current);
  if (!isDeepStrictEqual(baselineInference(), baseline.inference) || !isDeepStrictEqual(baselineEnvironment(), baseline.environment)) throw new Error("Reliability inference/environment drift.");
  for (const receipt of [...baseline.code, manifest.runtime, manifest.representativeBatchCheck, manifest.offlineGate, manifest.githubGate]) await verifyFile(receipt);
  if (resolve(process.env.DOCSYDE_RUN_RUNTIME_CONFIG ?? "") !== manifest.runtime.path) throw new Error("Reliability workflow path mismatch.");
  if (!process.env.BASETEN_API_KEY || !process.env.META_API_KEY || !(await loadRunRuntimeConfig(baseline.repository)).available) throw new Error("Reliability model/runtime prerequisites unavailable; no inference admitted.");
  const runtime = runRuntimeConfigSchema.parse(JSON.parse(await readFile(manifest.runtime.path, "utf8")));
  if (!isDeepStrictEqual(manifest.runtimeDescriptor, { id: runtime.id, version: runtime.version, sha256: documentationHash(runtime), capabilitiesSha256: documentationHash(runtime.capabilities) })) throw new Error("Reliability workflow identity mismatch.");
  const capability = { A: "urgent-request-result", B: "close-confirmation", C: "resolved-status-display" }[manifest.scenario];
  if (runtime.maxSelectedScreenshots !== 1 || runtime.capabilities.length !== 1 || runtime.capabilities[0].id !== capability || runtime.repository !== baseline.repository) throw new Error("Reliability capability isolation mismatch.");
  const batch = z.object({ eligible: z.literal(true), batchCount: z.literal(1), individuallyInfeasible: z.literal(0), authorizationFailures: z.literal(0),
    source: z.object({ repository: z.string(), base: z.literal(RELIABILITY_BASE), head: z.literal(manifest.head) }),
    targets: z.array(z.object({ documentId: z.uuid(), sha256: hash })).min(1) }).passthrough().parse(JSON.parse(await readFile(manifest.representativeBatchCheck.path, "utf8")));
  if (batch.source.repository.toLowerCase() !== baseline.repository || batch.targets.some(target => !baseline.documents.some(document => document.id === target.documentId && document.sha256 === target.sha256))) throw new Error("Representative batch targets do not match baseline corpus.");
  if (!batch.eligible) throw new Error("Outside single-batch baseline scope.");
  z.object({ passed: z.literal(true), scenario: z.literal(manifest.scenario), base: z.literal(RELIABILITY_BASE), head: z.literal(manifest.head), runtimeSha256: z.literal(manifest.runtime.sha256) }).passthrough().parse(JSON.parse(await readFile(manifest.offlineGate.path, "utf8")));
  z.object({ passed: z.literal(true), base: z.literal(RELIABILITY_BASE), head: z.literal(manifest.head), branch: z.literal(manifest.branch) }).passthrough().parse(JSON.parse(await readFile(manifest.githubGate.path, "utf8")));
}

/** Opt-in server entry. A manifest never authorizes inference; the operator starts a run separately. */
export async function withReliabilityBaseline<T>(id: string, input: z.infer<typeof runInput>, action: () => Promise<T>) {
  const path = process.env.DOCSYDE_RELIABILITY_MANIFEST;
  if (!path) return action();
  const manifestBytes = await readFile(path, "utf8");
  const manifestSha256 = bytesHash(manifestBytes);
  const manifest = reliabilityManifestSchema.parse(JSON.parse(manifestBytes));
  if (`https://github.com/${input.owner.toLowerCase()}/${input.repo.toLowerCase()}` !== manifest.baseline.repository
    || input.base !== RELIABILITY_BASE || input.head !== manifest.head || input.branch !== manifest.branch
    || input.runContext !== manifest.runContext || input.paths.length || input.associations.length) throw new Error("Reliability pinned run input mismatch.");
  await assertReliabilityBaseline(manifest);
  // One execution per sealed manifest. Preserve this receipt even after a failed attempt.
  await writeFile(`${path}.attempt.json`, JSON.stringify({ runId: id, scenario: manifest.scenario, head: manifest.head,
    startedAt: new Date().toISOString(), manifestSha256 }), { flag: "wx", mode: 0o600 });
  return withInferenceBudget(id, manifest.baseline.inference, action, async () => {
    if (bytesHash(await readFile(path)) !== manifestSha256) throw new Error("Sealed manifest changed during execution.");
    await assertReliabilityBaseline(manifest);
  });
}
