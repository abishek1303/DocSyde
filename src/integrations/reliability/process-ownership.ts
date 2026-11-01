import "server-only";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { ReliabilityIsolationError, type ReliabilityContext } from "./execution-context";

const owned = new WeakMap<ChildProcess, { experimentId: string; scenario: string | null }>();
export function spawnOwned(context: ReliabilityContext, command: string, args: string[], options: SpawnOptions) {
  if (!options.cwd || !options.env || options.shell) throw new ReliabilityIsolationError("explicit-process-options");
  const child = spawn(command, args, options);
  owned.set(child, { experimentId: context.experimentId, scenario: context.scenario });
  return child;
}
async function settledWithin(action: Promise<unknown>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([action.then(() => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
export async function stopOwned(context: ReliabilityContext, child: ChildProcess, timeoutMs = 2000) {
  const owner = owned.get(child);
  if (!owner || owner.experimentId !== context.experimentId || owner.scenario !== context.scenario) throw new ReliabilityIsolationError("process-owner");
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => { child.once("exit", () => resolve()); child.once("error", () => resolve()); });
  child.kill("SIGTERM");
  if (await settledWithin(exited, timeoutMs)) return;
  child.kill("SIGKILL");
  if (!await settledWithin(exited, timeoutMs)) throw new ReliabilityIsolationError("process-stop-timeout");
}
export async function closeBrowserAndChild(context: ReliabilityContext, browser: { close(): Promise<void> } | undefined, child: ChildProcess, timeoutMs = 2000) {
  const failures: unknown[] = [];
  try { if (browser && !await settledWithin(browser.close(), timeoutMs)) throw new ReliabilityIsolationError("browser-stop-timeout"); } catch (error) { failures.push(error); }
  try { await stopOwned(context, child, timeoutMs); } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, "Owned runtime cleanup incomplete.");
}
export async function closeBrowserWithin(browser: { close(): Promise<void> }, timeoutMs = 2000) {
  if (!await settledWithin(browser.close(), timeoutMs)) throw new ReliabilityIsolationError("browser-stop-timeout");
}
