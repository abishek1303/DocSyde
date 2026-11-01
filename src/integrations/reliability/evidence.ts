import "server-only";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { reliabilityHash, runtimeIdentitySchema, ReliabilityIsolationError, type ReliabilityContext } from "./execution-context";
import { assertNoSymlink, ownedPath } from "./owned-resources";
import { assertRuntimeIdentity } from "./runtime-identity";

export const offlineReceiptSchema = z.object({
  version: z.literal(2), passed: z.literal(true), experimentId: z.string(), scenario: z.enum(["A", "B", "C"]),
  docsydeSha: z.string(), head: z.string().nullable(), base: z.string(), runtimeSha256: reliabilityHash,
  runtimeIdentity: runtimeIdentitySchema, workflowSha256: reliabilityHash, capabilitiesSha256: reliabilityHash,
  contractConfigSha256: reliabilityHash, directoryId: z.uuid(), evidenceDirectory: z.string(),
  evidenceFiles: z.array(z.object({ path: z.string().regex(/^(?!.*\.\.)(?!\/)[a-zA-Z0-9_./-]+$/), sha256: reliabilityHash }).strict()).min(5),
  inferenceCalls: z.literal(0), checks: z.array(z.string()),
}).passthrough();
export async function verifyOfflineReceipt(context: ReliabilityContext, path: string) {
  await ownedPath(context, path);
  const receipt = offlineReceiptSchema.parse(JSON.parse(await readFile(path, "utf8")));
  if (receipt.experimentId !== context.experimentId || receipt.scenario !== context.scenario || receipt.docsydeSha !== context.docsydeSha
    || receipt.head !== context.requestDeskSha || resolve(receipt.evidenceDirectory) !== dirname(resolve(path)) || !context.runtimeIdentity) throw new ReliabilityIsolationError("offline-receipt-context");
  assertRuntimeIdentity(context.runtimeIdentity, receipt.runtimeIdentity);
  const owner = JSON.parse(await readFile(join(dirname(path), "evidence/.reliability-owner.json"), "utf8"));
  if (owner.token !== receipt.directoryId || owner.experimentId !== context.experimentId || owner.scenario !== context.scenario) throw new ReliabilityIsolationError("evidence-directory-identity");
  const paths = receipt.evidenceFiles.map(file => file.path);
  if (new Set(paths).size !== paths.length || ["contracts.txt", "build.txt", "tests.txt", "runtime.json", "trace.json"].some(required => !paths.includes(required))) throw new ReliabilityIsolationError("evidence-incomplete");
  for (const file of receipt.evidenceFiles) {
    const target = join(dirname(path), "evidence", file.path); await assertNoSymlink(target);
    if (createHash("sha256").update(await readFile(target)).digest("hex") !== file.sha256) throw new ReliabilityIsolationError("evidence-integrity");
  }
  return receipt;
}
