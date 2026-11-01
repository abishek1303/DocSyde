import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ChildProcess, execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { parseReliabilityContext, assertScenarioContext, type ReliabilityContext } from "@/integrations/reliability/execution-context";
import { assertOwnedRoot, freshEvidence, ownedPath, prepareOwnedRoot, removeOwnedTemporary, reserveAttempt } from "@/integrations/reliability/owned-resources";
import { reliabilityEnvironment } from "@/integrations/reliability/subprocess-environment";
import { spawnOwned, stopOwned, closeBrowserAndChild } from "@/integrations/reliability/process-ownership";
import { verifyRuntimeIdentity, assertRuntimeIdentity } from "@/integrations/reliability/runtime-identity";
import { assertPublicationEvidenceContext, observePublicationMutation } from "./publication-evidence";
import { assertComparableReports } from "./report";
import { reliabilityComparisonIdentity } from "@/features/documentation/runs/reliability-comparison";
import type { ReliabilityManifest } from "@/features/documentation/runs/reliability-baseline";

const exec = promisify(execFile), root = process.cwd(), sha = "a".repeat(40), hash = "b".repeat(64);
async function fixture(t: TestContext) {
  const experimentId = `isolation-test-${randomUUID()}`;
  const outputRoot = join(root, ".artifacts/reliability", experimentId, "A");
  const identity = { version: 1 as const, experimentId, scenario: "A" as const, docsydeSha: sha, requestDeskSha: sha,
    buildSha256: hash, workflowVersion: "1" as const, runtimeVersion: "request-desk-reliability-v1" as const };
  const context = parseReliabilityContext({ version: 1, experimentId, scenario: "A", mode: "offline", repositoryRoot: root,
    docsydeSha: sha, requestDeskSha: sha, outputRoot, runtimeIdentity: identity, manifestPath: null });
  await prepareOwnedRoot(context);
  const path = join(outputRoot, "context.json"); await writeFile(path, JSON.stringify(context), { flag: "wx" });
  t.after(async () => { await assertOwnedRoot(context); await rm(dirname(outputRoot), { recursive: true }); });
  return { context, path, identity };
}
async function child(context: ReliabilityContext, path: string, code: string, sandbox = false) {
  return exec(process.execPath, ["--conditions=react-server", "--import", "tsx", ...(sandbox ? ["--import", join(root, "infra/local/reliability/offline-preload.ts")] : []), "-e", code],
    { cwd: root, env: reliabilityEnvironment(context, path, sandbox ? "contracts" : "tools", { DOCSYDE_RELIABILITY_CONTRACT_WORKER: "1" }), timeout: 20_000 });
}

test("context is immutable and rejects another scenario or its filesystem root", async t => {
  const f = await fixture(t);
  assert.ok(Object.isFrozen(f.context)); assert.ok(Object.isFrozen(f.context.runtimeIdentity));
  assert.throws(() => assertScenarioContext(f.context, "B"));
  assert.throws(() => parseReliabilityContext({ ...f.context, scenario: "B" }));
  const b = parseReliabilityContext({ ...f.context, scenario: "B", outputRoot: join(dirname(f.context.outputRoot), "B"), runtimeIdentity: null });
  await prepareOwnedRoot(b);
  await assert.rejects(ownedPath(b, join(f.context.outputRoot, "trace.json")));
  await assert.rejects(assertOwnedRoot({ ...b, outputRoot: f.context.outputRoot }));
});

test("a reliability entry without context fails before creating output or executing work", async t => {
  const f = await fixture(t), env = reliabilityEnvironment(f.context, f.path, "tools");
  delete env.DOCSYDE_RELIABILITY_CONTEXT;
  await assert.rejects(exec(process.execPath, ["--conditions=react-server", "--import", "tsx", "-e",
    `require('./src/integrations/reliability/execution-context.ts').requireReliabilityContext()`], { cwd: root, env, timeout: 10_000 }));
});

test("subprocess environment drops ambient database, Git, Node, proxy, browser and scenario values", async t => {
  const f = await fixture(t);
  const env = reliabilityEnvironment(f.context, f.path, "contracts", {}, { NODE_ENV: "production", PATH: "/bin", DATABASE_URL: "SECRET",
    GIT_DIR: "wrong", GIT_WORK_TREE: "wrong", NODE_OPTIONS: "--require=wrong", HTTPS_PROXY: "wrong", PLAYWRIGHT_BROWSERS_PATH: "wrong",
    DOCSYDE_RELIABILITY_MANIFEST: "wrong", BASETEN_API_KEY: "SECRET", META_API_KEY: "SECRET", GITHUB_TOKEN: "SECRET" });
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "NODE_OPTIONS", "HTTPS_PROXY", "PLAYWRIGHT_BROWSERS_PATH", "DOCSYDE_RELIABILITY_MANIFEST"]) assert.equal(env[key], undefined);
  for (const key of ["DATABASE_URL", "BASETEN_API_KEY", "META_API_KEY", "GITHUB_TOKEN"]) assert.equal(env[key], "");
  assert.equal(env.NODE_ENV, "test"); assert.equal(env.TMPDIR, join(f.context.outputRoot, "tmp"));
  assert.equal(JSON.stringify(env).includes("SECRET"), false);
});

test("offline children reject sockets, unmocked providers, persistence and external commands even when caught", async t => {
  const f = await fixture(t);
  for (const operation of [
    `try { require('node:net').connect(5432, '127.0.0.1'); } catch {}`,
    `try { fetch('https://inference.baseten.co/v1/chat/completions'); } catch {}`,
    `try { require('node:child_process').spawn(process.execPath, ['-e', 'process.exit(0)']); } catch {}`,
  ]) await assert.rejects(child(f.context, f.path, operation, true));
  await assert.rejects(child(f.context, f.path, `require('./src/integrations/ai/invocation-log.ts').logStructuredInvocation({provider:'baseten'},async()=>({model:'mock'})).catch(()=>{process.exitCode=13})`), error => error instanceof Error && "code" in error && error.code === 13);
  await assert.rejects(child(f.context, f.path, `require('./src/integrations/ai/baseten/invoke.ts').invokeBaseten({instructions:'fixture',input:'fixture',maxOutputTokens:1}).catch(()=>{process.exitCode=14})`), error => error instanceof Error && "code" in error && error.code === 14);
});

test("offline contract transport supports explicit Node fetch mocks and never writes invocation rows", async t => {
  const f = await fixture(t);
  const result = await child(f.context, f.path, `const {mock}=require('node:test'); const {z}=require('zod'); process.env.BASETEN_API_KEY='mock'; mock.method(globalThis,'fetch',async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'"ok"'}}]})); require('./src/integrations/ai/generate-structured.ts').generateStructured({instructions:'fixture',input:'fixture',schema:z.literal('ok')}).then(r=>{if(r.data!=='ok'||r.invocationId)process.exitCode=1});`, true);
  assert.equal(result.stderr, "");
});

test("fresh evidence refuses stale directories and a failed attempt cannot acquire a success marker", async t => {
  const f = await fixture(t), old = join(f.context.outputRoot, "old");
  await mkdir(old); await writeFile(join(old, "offline-gate.json"), '{"passed":true}');
  await assert.rejects(freshEvidence(f.context, old));
  const attempt = await freshEvidence(f.context, join(f.context.outputRoot, "new"));
  await writeFile(join(attempt.path, "contracts.txt"), "failure");
  await assert.rejects(access(join(attempt.target, "offline-gate.json")));
  assert.equal(await readFile(join(old, "offline-gate.json"), "utf8"), '{"passed":true}');
  const success = await freshEvidence(f.context, join(f.context.outputRoot, "complete"));
  await success.finalize({ passed: true });
  await assert.rejects(freshEvidence(f.context, success.target));
});

test("copied or resealed manifest paths cannot reserve another concurrent scenario attempt", async t => {
  const f = await fixture(t);
  const results = await Promise.allSettled([reserveAttempt(f.context, "execution", { manifestPath: "first.json" }), reserveAttempt(f.context, "execution", { manifestPath: "copied.json" })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  await assert.rejects(reserveAttempt(f.context, "execution", { manifestPath: "resealed.json" }));
});

test("wrong runtime SHA, build or scenario is rejected before a capture callback", async t => {
  const f = await fixture(t);
  for (const identity of [{ ...f.identity, scenario: "B" }, { ...f.identity, requestDeskSha: "c".repeat(40) }, { ...f.identity, buildSha256: "c".repeat(64) }]) {
    let captured = false;
    const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(identity));
    await assert.rejects(verifyRuntimeIdentity("http://127.0.0.1:45873", f.identity).then(() => { captured = true; }));
    assert.equal(captured, false); assert.equal(fetch.mock.callCount(), 1); fetch.mock.restore();
  }
  assert.doesNotThrow(() => assertRuntimeIdentity(f.identity, { ...f.identity }));
});

test("the production capture entry rejects offline inspection before launching Chromium", async t => {
  const f = await fixture(t);
  await assert.rejects(child(f.context, f.path, `require('./src/runner/runtime/capture-workflow.ts').captureWorkflowWithRuntime({runtime:{mode:'attach',options:{baseUrl:'http://127.0.0.1:1'}},workflow:{}},{store(){throw Error('capture must not run')},read(){}}).catch(()=>{process.exitCode=17})`, true));
});

test("the production capture entry rejects wrong scenario/SHA health before browser dispatch", async t => {
  const f = await fixture(t);
  const scenario = parseReliabilityContext({ ...f.context, mode: "scenario", manifestPath: join(f.context.outputRoot, "manifest.json") });
  const path = join(f.context.outputRoot, "scenario-context.json"); await writeFile(path, JSON.stringify(scenario), { flag: "wx" });
  for (const changed of [{ ...f.identity, scenario: "B" }, { ...f.identity, requestDeskSha: "d".repeat(40) }]) {
    const result = await child(scenario, path, `globalThis.fetch=async()=>Response.json(${JSON.stringify(changed)});require('./src/runner/runtime/capture-workflow.ts').captureWorkflowWithRuntime({runtime:{mode:'attach',options:{baseUrl:'http://127.0.0.1:45873'}},workflow:{}},{store(){throw Error('capture dispatched')},read(){}}).then(()=>{process.exitCode=1}).catch(e=>{if(e.code!=='runtime-identity-mismatch')throw e})`);
    assert.equal(result.stderr, "");
  }
});

test("a scenario process cannot bypass admission by calling provider transport directly", async t => {
  const f = await fixture(t);
  const scenario = parseReliabilityContext({ ...f.context, mode: "scenario", manifestPath: join(f.context.outputRoot, "manifest.json") });
  const path = join(f.context.outputRoot, "scenario-context.json"); await writeFile(path, JSON.stringify(scenario), { flag: "wx" });
  const result = await child(scenario, path, `globalThis.fetch=()=>{throw Error('network must not run')};require('./src/integrations/ai/baseten/invoke.ts').invokeBaseten({instructions:'fixture',input:'fixture',maxOutputTokens:1}).then(()=>{process.exitCode=1}).catch(e=>{if(e.code!=='unguarded-baseline-call')throw e})`);
  assert.equal(result.stderr, "");
});

test("cleanup rejects unowned directories and symlink aliases without removing their files", async t => {
  const f = await fixture(t), unowned = join(f.context.outputRoot, "unowned"); await mkdir(unowned); await writeFile(join(unowned, "keep"), "keep");
  await assert.rejects(removeOwnedTemporary(f.context, unowned, randomUUID()));
  const owned = await freshEvidence(f.context, join(f.context.outputRoot, "owned"));
  await symlink(unowned, join(f.context.outputRoot, "alias"));
  await assert.rejects(removeOwnedTemporary(f.context, join(f.context.outputRoot, "alias"), owned.token));
  assert.equal(await readFile(join(unowned, "keep"), "utf8"), "keep");
  await removeOwnedTemporary(f.context, owned.path, owned.token);
  await assert.rejects(access(owned.path));
});

test("cleanup never kills an unowned child and browser failure still terminates its owned child within a bound", async t => {
  const f = await fixture(t), unowned = new ChildProcess();
  const kill = t.mock.method(unowned, "kill");
  await assert.rejects(stopOwned(f.context, unowned, 50)); assert.equal(kill.mock.callCount(), 0);
  const owned = spawnOwned(f.context, process.execPath, ["-e", "setInterval(()=>{},1000)"], { cwd: root, env: reliabilityEnvironment(f.context, f.path, "tools"), stdio: "ignore" });
  await new Promise<void>((resolve, reject) => { owned.once("spawn", resolve); owned.once("error", reject); });
  const started = Date.now();
  await assert.rejects(closeBrowserAndChild(f.context, { async close() { throw new Error("browser failure"); } }, owned, 200));
  assert.ok(owned.exitCode !== null || owned.signalCode !== null); assert.ok(Date.now() - started < 2500);
});

test("a hung browser and SIGTERM-resistant owned child have bounded cleanup", async t => {
  const f = await fixture(t);
  const owned = spawnOwned(f.context, process.execPath, ["-e", "process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"],
    { cwd: root, env: reliabilityEnvironment(f.context, f.path, "tools"), stdio: ["ignore", "pipe", "ignore"] });
  t.after(() => stopOwned(f.context, owned, 100));
  await new Promise<void>((resolve, reject) => { owned.stdout!.once("data", () => resolve()); owned.once("error", reject); });
  const started = Date.now();
  await assert.rejects(closeBrowserAndChild(f.context, { close: () => new Promise<void>(() => {}) }, owned, 100));
  assert.equal(owned.signalCode, "SIGKILL"); assert.ok(Date.now() - started < 2500);
});

test("publication evidence rejects another runtime/scenario and reads delivery after lost acknowledgement", async t => {
  const f = await fixture(t), evidence = { experimentId: f.context.experimentId, scenario: "A", runtimeIdentity: f.identity, route: "/requests/new" };
  assert.doesNotThrow(() => assertPublicationEvidenceContext(f.context, evidence, "/requests/new"));
  for (const changed of [{ ...evidence, scenario: "B" }, { ...evidence, runtimeIdentity: { ...f.identity, buildSha256: "c".repeat(64) } }, { ...evidence, route: "/requests" }]) assert.throws(() => assertPublicationEvidenceContext(f.context, changed, "/requests/new"));
  let observed = 0;
  const result = await observePublicationMutation(async () => { throw new Error("ack lost after commit"); }, async () => { observed++; return { documentId: "observed-save" }; });
  assert.deepEqual(result, { acknowledged: false, observed: { documentId: "observed-save" } }); assert.equal(observed, 1);
});

test("report comparison requires identical semantic baseline keys but ignores physical instance IDs", () => {
  const identity = { specificationVersion: 2 as const, docsydeSha: sha, requestDeskBase: sha, contractConfigSha256: hash, runtimePolicySha256: hash, corpusSha256: hash, baselineSha256: hash };
  const reports = ["A", "B", "C"].map((scenario, index) => ({ scenario, experimentId: "one", comparisonIdentity: { ...identity }, port: index, pid: index, path: `/tmp/${index}` }));
  assert.doesNotThrow(() => assertComparableReports(reports));
  for (const key of Object.keys(identity) as (keyof typeof identity)[]) {
    const changed = structuredClone(reports); Object.assign(changed[1].comparisonIdentity, { [key]: key === "specificationVersion" ? 3 : "changed" });
    assert.throws(() => assertComparableReports(changed));
  }
});

test("semantic comparison normalizes unordered corpus/publications and excludes absolute storage paths", () => {
  const baseline: ReliabilityManifest["baseline"] = { version: 1, specificationVersion: 2, experimentId: "one", runtimePolicySha256: hash,
    docsydeSha: sha, requestDeskBase: "45799b2fae07f1326296b8ba85fae51476fd153d", repository: "https://github.com/abishek1303/docsyde", sourceDatabase: "original", serverIdentity: hash,
    code: [{ path: "/machine/code", sha256: hash }], inference: {}, environment: { DOCSYDE_STORAGE_DIRECTORY: "/machine/A", NODE_ENV: "production" },
    documents: [{ id: "b", sha256: hash, projectionSha256: hash }, { id: "a", sha256: hash, projectionSha256: hash }], publications: [], contextSha256: hash, schemaFingerprintVersion: 2 as const, schemaSha256: hash, runContext: null };
  const changed = structuredClone(baseline); changed.documents.reverse(); changed.environment.DOCSYDE_STORAGE_DIRECTORY = "/other/B"; changed.sourceDatabase = "other";
  assert.deepEqual(reliabilityComparisonIdentity(baseline), reliabilityComparisonIdentity(changed));
  changed.documents[0].sha256 = "c".repeat(64); assert.notDeepEqual(reliabilityComparisonIdentity(baseline), reliabilityComparisonIdentity(changed));
});
