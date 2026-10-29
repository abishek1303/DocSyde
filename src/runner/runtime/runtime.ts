import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
export type RuntimeDescription = { runtimeId: string; mode: "launched" | "attached"; baseUrl: string; startedAt: string; pid?: number };
export type RuntimeSession = { description: RuntimeDescription; stop(): Promise<void> };
export function localUrl(value: string): URL {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Expected a loopback HTTP URL");
  return url;
}
type Options = { baseUrl: string; readinessPath?: string; startupTimeoutMs?: number; signal?: AbortSignal };
async function ready(options: Options, failed: () => boolean) {
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
export async function attachRuntime(options: Options): Promise<RuntimeSession> {
  localUrl(options.baseUrl); await ready(options, () => false);
  return { description: { runtimeId: randomUUID(), mode: "attached", baseUrl: options.baseUrl, startedAt: new Date().toISOString() }, async stop() {} };
}
export async function launchRuntime(options: Options & { cwd: string; command: string; args: string[]; env?: Record<string, string> }): Promise<RuntimeSession> {
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
  const child = spawn(options.command, options.args, { cwd: options.cwd, env, shell: false, stdio: "ignore" });
  let failed = false;
  const exited = new Promise<void>((resolve) => { child.once("error", () => { failed = true; resolve(); }); child.once("exit", () => { failed = true; resolve(); }); });
  let stopping: Promise<void> | undefined;
  const stop = () => stopping ??= (async () => {
    if (failed) return;
    child.kill();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([exited, new Promise<void>((resolve) => { timer = setTimeout(resolve, 2000); })]);
    if (timer) clearTimeout(timer);
    if (!failed) { child.kill("SIGKILL"); await exited; }
  })();
  try { await ready(options, () => failed); }
  catch (error) { await stop(); throw error; }
  return { description: { runtimeId: randomUUID(), mode: "launched", baseUrl: options.baseUrl, startedAt: new Date().toISOString(), pid: child.pid }, stop };
}
