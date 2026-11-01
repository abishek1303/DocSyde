import "server-only";
import { isDeepStrictEqual } from "node:util";
import type { ChildProcess } from "node:child_process";
import { stopOwned, assertOwnedProcess } from "./process-ownership";
import { verifyRuntimeIdentity } from "./runtime-identity";
import { verifyDocsydeIdentity } from "./docsyde-identity";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ownedPath } from "./owned-resources";
import { ReliabilityIsolationError, type ReliabilityContext } from "./execution-context";

const recordSchema = z.object({ version: z.literal(2), experimentId: z.string(), scenario: z.string(), token: z.uuid(),
  launcherPid: z.number().int().positive(), childPid: z.number().int().positive().nullable(),
  state: z.enum(["acquiring", "running", "stopped"]), runtimeIdentity: z.unknown() }).strict();
type Record = z.infer<typeof recordSchema>;
function dead(pid: number) {
  try { process.kill(pid, 0); return false; }
  catch (error) { return error instanceof Error && "code" in error && error.code === "ESRCH"; }
}
/** A tiny host-specific record mutex. An interrupted mutex is ambiguous and is
 * never stolen. No PID from disk is ever used to signal or kill a process. */
async function locked<T>(context: ReliabilityContext, action: () => Promise<T>, kind: "host" | "docsyde" = "host") {
  const guard = await ownedPath(context, join(context.outputRoot, `${kind}-record.guard`));
  try { await mkdir(guard, { mode: 0o700 }); } catch { throw new ReliabilityIsolationError("host-record-busy-or-ambiguous"); }
  try { return await action(); } finally { await rmdir(guard); }
}
async function read(context: ReliabilityContext, kind: "host" | "docsyde" = "host"): Promise<Record | null> {
  const path = await ownedPath(context, join(context.outputRoot, `${kind}-process.json`));
  let bytes: string;
  try { bytes = await readFile(path, "utf8"); } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  const parsed = recordSchema.safeParse(JSON.parse(bytes));
  if (!parsed.success || parsed.data.experimentId !== context.experimentId || parsed.data.scenario !== context.scenario || !isDeepStrictEqual(parsed.data.runtimeIdentity, context.runtimeIdentity)) throw new ReliabilityIsolationError("host-record-unverifiable");
  return parsed.data;
}
async function persist(context: ReliabilityContext, record: Record, phase: string, kind: "host" | "docsyde" = "host") {
  const history = await ownedPath(context, join(context.outputRoot, `${kind}-history`)); await mkdir(history, { recursive: true, mode: 0o700 });
  const bytes = JSON.stringify(record, null, 2);
  await writeFile(join(history, `${record.token}.${phase}.json`), bytes, { flag: "wx", mode: 0o600 });
  const temporary = await ownedPath(context, join(context.outputRoot, `${kind}-process.${randomUUID()}.tmp`));
  await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
  await rename(temporary, join(context.outputRoot, `${kind}-process.json`));
}
export async function acquireHost(context: ReliabilityContext, kind: "host" | "docsyde" = "host") {
  if (!context.scenario) throw new ReliabilityIsolationError("host-scenario");
  const record = await locked(context, async () => {
    const previous = await read(context, kind);
    if (previous?.state === "stopped") {
      const proofPath = await ownedPath(context, join(context.outputRoot, `${kind}-history`, `${previous.token}.stopped.json`));
      let proof: unknown;
      try { proof = JSON.parse(await readFile(proofPath, "utf8")); } catch { throw new ReliabilityIsolationError("host-stop-unverifiable"); }
      if (!isDeepStrictEqual(proof, previous)) throw new ReliabilityIsolationError("host-stop-unverifiable");
    }
    if (previous && previous.state !== "stopped") {
      // A missing child identity during acquisition cannot prove no child escaped.
      if (!previous.childPid || !dead(previous.childPid) || !dead(previous.launcherPid)) throw new ReliabilityIsolationError("host-live-or-ambiguous");
      await persist(context, { ...previous, state: "stopped" }, "observed-dead", kind);
    }
    const next: Record = { version: 2, experimentId: context.experimentId, scenario: context.scenario!, token: randomUUID(),
      launcherPid: process.pid, childPid: null, state: "acquiring", runtimeIdentity: context.runtimeIdentity };
    await persist(context, next, "acquired", kind); return next;
  }, kind);
  let launched: ChildProcess | undefined;
  async function transition(state: "running" | "stopped", childPid: number | null) {
    await locked(context, async () => {
      const current = await read(context, kind);
      if (current?.token !== record.token || current.state === "stopped") throw new ReliabilityIsolationError("host-ownership-lost");
      await persist(context, { ...record, childPid, state }, state, kind);
    }, kind);
  }
  return { token: record.token, healthy: async (server?: { port: string; databaseName: string; buildId: string }) => {
    if (!context.runtimeIdentity) throw new ReliabilityIsolationError("host-runtime-identity");
    if (kind === "host") await verifyRuntimeIdentity("http://127.0.0.1:45873", context.runtimeIdentity);
    else {
      if (!server || !launched?.pid) throw new ReliabilityIsolationError("docsyde-identity-required");
      await verifyDocsydeIdentity(context, record.token, launched.pid, server);
    }
    await locked(context, async () => {
      const current = await read(context, kind);
      if (current?.token !== record.token || current.state !== "running") throw new ReliabilityIsolationError("host-ownership-lost");
      await persist(context, current, "healthy", kind);
    }, kind);
  }, running: async (child: ChildProcess) => {
    assertOwnedProcess(context, child);
    if (!child.pid) throw new ReliabilityIsolationError("host-child-identity");
    launched = child; await transition("running", child.pid);
  },
    // Called only after the launcher's owned ChildProcess handle confirms exit,
    // or when preparation failed before any spawn was attempted.
    stopped: async (child?: ChildProcess) => {
      if (launched && child !== launched) throw new ReliabilityIsolationError("host-child-ownership");
      if (child) await stopOwned(context, child);
      await transition("stopped", child?.pid ?? null);
    } };
}

const digest = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
/** Seal only after the real launcher proved two healthy, cleanly stopped generations. */
export async function recordHostRestartReadiness(context: ReliabilityContext, kind: "host" | "docsyde" = "host") {
  const history = await ownedPath(context, join(context.outputRoot, `${kind}-history`));
  const tokens = (await readdir(history)).filter(name => name.endsWith(".stopped.json")).map(name => name.split(".")[0]);
  const files: { path: string; sha256: string }[] = [];
  const proven: string[] = [];
  for (const token of tokens) {
    const generation: { path: string; sha256: string }[] = [];
    try {
      for (const phase of ["running", "healthy", "stopped"]) {
        const path = join(history, `${token}.${phase}.json`); const bytes = await readFile(path, "utf8");
        const record = recordSchema.parse(JSON.parse(bytes));
        if (record.token !== token || record.experimentId !== context.experimentId || record.scenario !== context.scenario
          || !isDeepStrictEqual(record.runtimeIdentity, context.runtimeIdentity) || !record.childPid
          || record.state !== (phase === "stopped" ? "stopped" : "running")) throw new ReliabilityIsolationError("host-restart-history");
        generation.push({ path, sha256: digest(bytes) });
      }
    } catch { continue; }
    proven.push(token); files.push(...generation); if (proven.length === 2) break;
  }
  if (proven.length !== 2) throw new ReliabilityIsolationError("host-restart-not-proven");
  const path = await ownedPath(context, join(context.outputRoot, `${kind}-restart.json`));
  await writeFile(path, JSON.stringify({ version: 1, experimentId: context.experimentId, scenario: context.scenario, runtimeIdentity: context.runtimeIdentity,
    tokens: proven, files, passed: true }, null, 2), { flag: "wx", mode: 0o600 });
}
export async function verifyHostRestartReadiness(context: ReliabilityContext, path: string, kind: "host" | "docsyde" = "host") {
  await ownedPath(context, path);
  const receipt = z.object({ version: z.literal(1), experimentId: z.literal(context.experimentId), scenario: z.literal(context.scenario),
    tokens: z.array(z.uuid()).length(2), files: z.array(z.object({ path: z.string(), sha256: z.string() })).length(6), passed: z.literal(true), runtimeIdentity: z.unknown() }).strict().parse(JSON.parse(await readFile(path, "utf8")));
  if (new Set(receipt.tokens).size !== 2 || !isDeepStrictEqual(receipt.runtimeIdentity, context.runtimeIdentity)) throw new ReliabilityIsolationError("host-restart-context");
  const expected = receipt.tokens.flatMap(token => ["running", "healthy", "stopped"].map(phase => join(context.outputRoot, `${kind}-history`, `${token}.${phase}.json`)));
  if (new Set(receipt.files.map(file => file.path)).size !== 6 || receipt.files.some(file => !expected.includes(file.path))) throw new ReliabilityIsolationError("host-restart-files");
  for (const file of receipt.files) {
    await ownedPath(context, file.path);
    if (digest(await readFile(file.path, "utf8")) !== file.sha256) throw new ReliabilityIsolationError("host-restart-integrity");
  }
}
