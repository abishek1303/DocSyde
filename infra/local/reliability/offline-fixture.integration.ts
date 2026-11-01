import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { parseReliabilityContext } from "@/integrations/reliability/execution-context";
import { prepareOwnedRoot, assertOwnedRoot } from "@/integrations/reliability/owned-resources";
import { reliabilityEnvironment } from "@/integrations/reliability/subprocess-environment";
import { REQUEST_DESK_BASE, scenarios } from "./workflows";

const exec = promisify(execFile);
// Explicit local browser verification, separate from the socket-free unit suite.
// Export gates have head:null and can never admit a paid experiment.
for (const scenario of scenarios) test(`owned offline ${scenario} fixture builds, checks contracts, captures and finalizes evidence`, { timeout: 120_000 }, async t => {
  const root = process.cwd(), experimentId = `fixture-test-${randomUUID()}`;
  const context = parseReliabilityContext({ version: 1, experimentId, scenario, mode: "offline", repositoryRoot: root,
    docsydeSha: "0".repeat(40), requestDeskSha: REQUEST_DESK_BASE, outputRoot: join(root, ".artifacts/reliability", experimentId, scenario), runtimeIdentity: null, manifestPath: null });
  await prepareOwnedRoot(context);
  t.after(async () => { await assertOwnedRoot(context); await rm(dirname(context.outputRoot), { recursive: true }); });
  const path = join(context.outputRoot, "context.json"); await writeFile(path, JSON.stringify(context), { flag: "wx" });
  await exec(process.execPath, ["--conditions=react-server", "--import", "tsx", "-e",
    `const {exportScenario,verifyOfflineScenario}=require('./infra/local/reliability/offline.ts');const {requireReliabilityContext}=require('./src/integrations/reliability/execution-context.ts');const {join}=require('node:path');const c=requireReliabilityContext();(async()=>{const checkout=join(c.outputRoot,'checkout');await exportScenario(c.scenario,checkout);await verifyOfflineScenario(c.scenario,checkout,join(c.outputRoot,'offline'),false)})().catch(e=>{console.error(e);process.exitCode=1})`],
  { cwd: root, env: reliabilityEnvironment(context, path, "tools"), timeout: 110_000, maxBuffer: 4 * 1024 * 1024 });
  const receipt = JSON.parse(await readFile(join(context.outputRoot, "offline/offline-gate.json"), "utf8"));
  assert.equal(receipt.passed, true); assert.equal(receipt.inferenceCalls, 0); assert.equal(receipt.head, null);
  assert.equal(receipt.runtimeIdentity.scenario, scenario); assert.equal(receipt.runtimeIdentity.requestDeskSha, REQUEST_DESK_BASE);
  assert.ok(receipt.evidenceFiles.some((file: { path: string }) => file.path === "trace.json"));
});
