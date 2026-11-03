import "server-only";
import { observe, type RuntimeObserver } from "@/integrations/browser/runtime-observation";
import { reliabilityContext, ReliabilityIsolationError, type ReliabilityRuntimeIdentity } from "@/integrations/reliability/execution-context";
import { verifyRuntimeIdentity } from "@/integrations/reliability/runtime-identity";
import { reliabilityEnvironment } from "@/integrations/reliability/subprocess-environment";
import { spawnOwned, stopOwned } from "@/integrations/reliability/process-ownership";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
export type RuntimeDescription = { runtimeId: string; mode: "launched" | "attached"; baseUrl: string; startedAt: string; pid?: number };
export class RuntimeCleanupError extends Error { constructor() { super("Owned runtime cleanup did not complete."); } }
export type RuntimeSession = { description: RuntimeDescription; stop(): Promise<void> };
export function localUrl(value: string): URL {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Expected a loopback HTTP URL");
  return url;
}
type Options = { baseUrl: string; readinessPath?: string; startupTimeoutMs?: number; signal?: AbortSignal; fixtureIdentity?: ReliabilityRuntimeIdentity; observer?: RuntimeObserver };
/** Probe only the operator-selected loopback health URL; never follow redirects. */
export async function probeRuntime(options: Pick<Options, "baseUrl" | "readinessPath" | "signal">): Promise<"healthy" | "occupied" | "offline"> {
  const base = localUrl(options.baseUrl), url = new URL(options.readinessPath ?? "/", base);
  if (url.origin !== base.origin) throw new Error("Readiness must use the runtime origin");
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.any([AbortSignal.timeout(750), ...(options.signal ? [options.signal] : [])]) });
    const healthy = response.ok; await response.body?.cancel();
    return healthy ? "healthy" : "occupied";
  } catch { return "offline"; }
}
async function waitForReady(options: Options, failed: () => boolean) {
  const base = localUrl(options.baseUrl), url = new URL(options.readinessPath ?? "/", base);
  if (url.origin !== base.origin) throw new Error("Readiness must use the runtime origin");
  const timeout = options.startupTimeoutMs ?? 60_000;
  if (!Number.isFinite(timeout) || timeout < 1) throw new Error("Invalid startup timeout");
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    options.signal?.throwIfAborted();
    if (failed()) throw new Error("Runtime exited before readiness");
    try { if ((await fetch(url, { redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(Math.min(1000, Math.max(1, deadline - Date.now()))), ...(options.signal ? [options.signal] : [])]) })).ok) return; } catch { /* Retry readiness only. */ }
    await delay(50);
  }
  throw new Error("Runtime readiness timed out");
}
async function ready(options: Options, failed: () => boolean) {
  observe(options.observer, { kind: "application-readiness-started", phase: "lifecycle" });
  try { await waitForReady(options, failed); }
  catch (error) { observe(options.observer, { kind: "failure", phase: "lifecycle", code: "application-readiness-failed" }); throw error; }
  observe(options.observer, { kind: "application-readiness-completed", phase: "lifecycle" });
}
export async function attachRuntime(options: Options): Promise<RuntimeSession> {
  const context = reliabilityContext();
  if (context) {
    const identity = context.runtimeIdentity ?? options.fixtureIdentity;
    if (process.env.DOCSYDE_RELIABILITY_CONTRACT_TEST === "1" || !["offline", "scenario"].includes(context.mode) || !identity
      || identity.experimentId !== context.experimentId || identity.scenario !== context.scenario || identity.requestDeskSha !== context.requestDeskSha
      || identity.docsydeSha !== context.docsydeSha) throw new ReliabilityIsolationError("runtime-attach");
    await verifyRuntimeIdentity(options.baseUrl, identity);
  }
  localUrl(options.baseUrl); await ready(options, () => false);
  return { description: { runtimeId: randomUUID(), mode: "attached", baseUrl: options.baseUrl, startedAt: new Date().toISOString() }, async stop() {} };
}
export async function launchRuntime(options: Options & { cwd: string; command: string; args: string[]; env?: Record<string, string>; ownedProcessGroup?: boolean }): Promise<RuntimeSession> {
  const context = reliabilityContext();
  if (context && (context.mode !== "scenario" || options.command !== process.execPath
    || !options.args.includes(join(context.repositoryRoot, "infra/local/reliability/request-desk-host.ts")))) throw new ReliabilityIsolationError("runtime-launch");
  const base = localUrl(options.baseUrl);
  if (!options.command || !Array.isArray(options.args)) throw new Error("Explicit executable and arguments required");
  let occupied = false;
  try {
    const response = await fetch(base, { redirect: "manual", signal: AbortSignal.timeout(500) });
    // Any HTTP response, including a redirect, proves an application is here.
    occupied = true;
    await response.body?.cancel();
  } catch { /* A connection failure is not evidence of an HTTP application. */ }
  if (occupied) throw new Error("Runtime URL already serves an application");
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "development" };
  for (const key of ["PATH", "Path", "HOME", "USERPROFILE", "SystemRoot", "TEMP", "TMP", "TMPDIR", "LANG"]) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, options.env);
  if (context && options.env && Object.keys(options.env).some(key => !["DOCSYDE_REPOSITORY_OWNER", "DOCSYDE_REPOSITORY_NAME", "DOCSYDE_DELIVERY_ENDPOINT"].includes(key))) throw new ReliabilityIsolationError("runtime-environment");
  const group = options.ownedProcessGroup === true && process.platform !== "win32" && !context;
  const child = context
    ? spawnOwned(context, options.command, options.args, { cwd: options.cwd, env: reliabilityEnvironment(context, process.env.DOCSYDE_RELIABILITY_CONTEXT!, "host", options.env), shell: false, stdio: "ignore" })
    : spawn(options.command, options.args, { cwd: options.cwd, env, shell: false, detached: group, stdio: "ignore" });
  let failed = false;
  let exitCode: number | null = null;
  const exited = new Promise<void>((resolve) => { child.once("error", () => { failed = true; observe(options.observer, { kind: "application-process-exit", phase: "lifecycle", exitCode: null }); resolve(); }); child.once("exit", code => { failed = true; exitCode = code; observe(options.observer, { kind: "application-process-exit", phase: "lifecycle", exitCode }); resolve(); }); });
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    if (failed && !group) return;
    observe(options.observer, { kind: "application-stopping-started", phase: "lifecycle" });
    if (context) return stopOwned(context, child);
    const signal = (kind: NodeJS.Signals) => {
      if (group && child.pid) {
        try { process.kill(-child.pid, kind); } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ESRCH")) throw new RuntimeCleanupError(); }
      } else if (!failed) child.kill(kind);
    };
    signal("SIGTERM");
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([exited, new Promise<void>((resolve) => { timer = setTimeout(resolve, 2000); })]);
    if (timer) clearTimeout(timer);
    // Package managers can exit before their grandchildren. Reap the owned group too.
    if (group || !failed) signal("SIGKILL");
    if (!failed) {
      let finalTimer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([exited, new Promise<never>((_resolve, reject) => { finalTimer = setTimeout(() => reject(new RuntimeCleanupError()), 2000); })]); }
      finally { clearTimeout(finalTimer); }
    }
  })();
  observe(options.observer, { kind: "application-launch-started", phase: "lifecycle" });
  try { await ready(options, () => failed); }
  catch (error) { await stop(); throw error; }
  return { description: { runtimeId: randomUUID(), mode: "launched", baseUrl: options.baseUrl, startedAt: new Date().toISOString(), pid: child.pid }, stop };
}
