import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { execFileSync, ChildProcess } from "node:child_process";
import childProcess from "node:child_process";
import { resolve, join, relative } from "node:path";
import { startManagedRuntime } from "./managed-runtime";
import { inspectCheckout, reviewManagedStartup, approvedStartup, verifyManagedStartup, ManagedRuntimeUnavailable } from "./managed-configuration";
import { approveRuntimeSettings, getRuntimeSettings, disableRuntimeStartup, loadApprovedRuntimeConfiguration } from "@/features/documentation/runs/runtime-settings";
import type { RuntimeObservationInput } from "@/integrations/browser/runtime-observation";

async function fixture(t: TestContext, dependencies = false) {
  await mkdir(".artifacts/managed-runtime-tests", { recursive: true });
  const root = await mkdtemp(resolve(".artifacts/managed-runtime-tests/case-"));
  const checkout = join(root, "checkout"); await mkdir(checkout);
  const repository = "https://github.com/fixture/project";
  const git = (...args: string[]) => execFileSync("git", args, { cwd: checkout, stdio: "ignore" });
  git("init"); git("remote", "add", "origin", `${repository}.git`);
  const manifest = { scripts: { dev: "vite & api --port 8787", predev: "node prepare.mjs" }, devDependencies: { ...(dependencies ? { vite: "1" } : {}) } };
  await writeFile(join(checkout, "package.json"), JSON.stringify(manifest));
  const workflow = join(root, "workflow.json");
  await writeFile(workflow, JSON.stringify({ repository, id: "fixture", version: "1", runtime: { mode: "attach", options: { baseUrl: "http://localhost:4317" } }, workflow: { sensitiveSelectors: ["input", "textarea"], steps: [{ type: "checkpoint" }] }, description: "Fixture", supportedPathnames: ["/"] }));
  const input = { repository, checkout, directory: ".", manager: "npm" as const, script: "dev", baseUrl: "http://localhost:4317", workflowPath: relative(process.cwd(), workflow) };
  const reviewed = await reviewManagedStartup(input);
  const approval = approvedStartup.parse({ version: 1, input: reviewed.input, fingerprint: reviewed.fingerprint, approvedAt: new Date().toISOString(), enabled: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, checkout, input, approval, manifest, options: { baseUrl: input.baseUrl, approval, startupTimeoutMs: 50 } };
}
function lifecycle(t: TestContext, health: "healthy" | "offline" | "unhealthy" | "exit" | "timeout", controller?: AbortController) {
  const events: RuntimeObservationInput[] = [], child = new ChildProcess(), signals: { pid: number; signal: string | number | undefined }[] = [];
  Object.defineProperty(child, "pid", { value: 43210 });
  let spawned = false;
  const spawn = t.mock.method(childProcess, "spawn", (_command: string, _args: readonly string[], options: childProcess.SpawnOptions) => {
    spawned = true; assert.equal(options.shell, false); assert.equal(options.detached, true);
    assert.equal(options.env?.MANAGED_PRIVATE_CREDENTIAL, undefined); assert.equal(options.stdio, "ignore");
    if (health === "exit") queueMicrotask(() => child.emit("exit", 1));
    return child;
  });
  t.mock.method(process, "kill", (pid: number, signal?: string | number) => { signals.push({ pid, signal }); child.emit("exit", null); return true; });
  t.mock.method(globalThis, "fetch", async () => {
    if (health === "healthy" || (spawned && health === "offline")) return new Response("ready");
    if (health === "unhealthy") return new Response("PRIVATE_RESPONSE", { status: 503 });
    if (spawned && controller) controller.abort();
    throw new Error("PRIVATE_CONNECTION_ERROR");
  });
  const prior = process.env.MANAGED_PRIVATE_CREDENTIAL; process.env.MANAGED_PRIVATE_CREDENTIAL = "PRIVATE_CREDENTIAL";
  t.after(() => { if (prior === undefined) delete process.env.MANAGED_PRIVATE_CREDENTIAL; else process.env.MANAGED_PRIVATE_CREDENTIAL = prior; });
  return { spawn, signals, events, observer: { event(event: RuntimeObservationInput) { events.push(event); }, preview() {} } };
}
test("manifest detection is advisory and approval is separate, explicit and project scoped", async t => {
  const f = await fixture(t, true), spawn = t.mock.method(childProcess, "spawn", () => { throw new Error("Discovery must not launch"); });
  const discovered = await inspectCheckout(f.input.repository, f.checkout);
  assert.equal(discovered.suggested.script, "dev"); assert.equal(discovered.suggested.baseUrl, "http://localhost:5173", "prefer frontend URL over the parallel API port");
  const old = process.env.DOCSYDE_ANALYSIS_REPOSITORIES; process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "fixture/project,fixture/other";
  t.after(() => { if (old === undefined) delete process.env.DOCSYDE_ANALYSIS_REPOSITORIES; else process.env.DOCSYDE_ANALYSIS_REPOSITORIES = old; });
  const store = join(f.root, "settings"), { repository, ...input } = f.input; void repository;
  const raw = { ...input, repository: "fixture/project", fingerprint: f.approval.fingerprint };
  await assert.rejects(approveRuntimeSettings(raw, store));
  assert.equal(await getRuntimeSettings("fixture/project", store), null);
  await approveRuntimeSettings({ ...raw, confirmed: true }, store);
  assert.equal((await getRuntimeSettings("fixture/project", store))?.enabled, true);
  assert.equal(await getRuntimeSettings("fixture/other", store), null);
  assert.equal((await loadApprovedRuntimeConfiguration(f.input.repository, store)).status, "approved");
  await disableRuntimeStartup("fixture/project", store);
  const disabled = await loadApprovedRuntimeConfiguration(f.input.repository, store);
  assert.ok(disabled.status === "approved" && disabled.config.runtime.mode === "attach");
  assert.equal(spawn.mock.callCount(), 0);
});
test("settings, lifecycle scripts, lockfiles and workflow edits invalidate approval before dispatch", async t => {
  const f = await fixture(t), life = lifecycle(t, "offline");
  await writeFile(join(f.checkout, "package-lock.json"), "changed lock");
  await assert.rejects(startManagedRuntime({ ...f.options, observer: life.observer }), { code: "approval-required" });
  assert.equal(life.spawn.mock.callCount(), 0);
  await rm(join(f.checkout, "package-lock.json"));
  await writeFile(join(f.checkout, "package.json"), JSON.stringify({ ...f.manifest, scripts: { ...f.manifest.scripts, predev: "changed command" } }));
  await assert.rejects(verifyManagedStartup(f.approval), { code: "approval-required" });
});
test("checkout identity, symlink escapes, shell arguments and non-loopback URLs are rejected", async t => {
  const f = await fixture(t); await symlink(f.root, join(f.checkout, "outside"));
  await assert.rejects(inspectCheckout("https://github.com/fixture/other", f.checkout));
  for (const change of [{ directory: "outside" }, { script: "dev; echo secret" }, { baseUrl: "https://example.com" }]) await assert.rejects(reviewManagedStartup({ ...f.input, ...change }));
});
test("healthy external application is reused and never stopped", async t => {
  const f = await fixture(t), life = lifecycle(t, "healthy");
  const session = await startManagedRuntime({ ...f.options, observer: life.observer });
  assert.equal(session.description.mode, "attached"); await session.stop();
  assert.equal(life.spawn.mock.callCount(), 0); assert.deepEqual(life.signals, []);
});
test("offline startup executes only the approved package script and stops its owned process group once", async t => {
  const f = await fixture(t), life = lifecycle(t, "offline");
  const session = await startManagedRuntime({ ...f.options, observer: life.observer });
  assert.equal(session.description.mode, "launched"); await session.stop(); await session.stop();
  assert.deepEqual(life.spawn.mock.calls[0].arguments[1], ["run", "dev"]);
  assert.ok(life.signals.length > 0 && life.signals.every(value => value.pid === -43210));
  assert.equal(life.events.filter(event => event.kind === "application-stopping-started").length, 1);
  assert.ok(!JSON.stringify(life.events).includes("PRIVATE"));
});
for (const phase of ["exit", "timeout", "unhealthy"] as const) test(`${phase} is bounded, sanitized and cannot kill an existing server`, async t => {
  const f = await fixture(t), life = lifecycle(t, phase);
  await assert.rejects(startManagedRuntime({ ...f.options, observer: life.observer }), ManagedRuntimeUnavailable);
  if (phase === "unhealthy") { assert.equal(life.spawn.mock.callCount(), 0); assert.deepEqual(life.signals, []); }
  else assert.ok(life.signals.length > 0 && life.signals.every(value => value.pid === -43210));
  assert.ok(!JSON.stringify(life.events).includes("PRIVATE"));
});
test("missing dependencies and cancellation never orphan owned processes", async t => {
  const f = await fixture(t, true), life = lifecycle(t, "offline");
  await assert.rejects(startManagedRuntime(f.options), { code: "dependencies-missing" }); assert.equal(life.spawn.mock.callCount(), 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(startManagedRuntime({ ...f.options, signal: controller.signal })); assert.equal(life.spawn.mock.callCount(), 0);
});
test("cancellation during readiness stops the whole owned process group", async t => {
  const f = await fixture(t), controller = new AbortController(), life = lifecycle(t, "timeout", controller);
  await assert.rejects(startManagedRuntime({ ...f.options, signal: controller.signal, observer: life.observer }));
  assert.ok(life.signals.length > 0 && life.signals.every(value => value.pid === -43210));
});
