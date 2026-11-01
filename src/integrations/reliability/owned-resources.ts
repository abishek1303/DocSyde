import "server-only";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { ReliabilityIsolationError, type ReliabilityContext } from "./execution-context";

const marker = ".reliability-owner.json";
export async function assertNoSymlink(path: string) {
  const absolute = resolve(path);
  for (let current = absolute; ; current = dirname(current)) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new ReliabilityIsolationError("symlink-resource"); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    if (dirname(current) === current) break;
  }
}
export async function assertOwnedRoot(context: ReliabilityContext) {
  await assertNoSymlink(context.outputRoot);
  if (await realpath(context.repositoryRoot) !== context.repositoryRoot) throw new ReliabilityIsolationError("repository-realpath");
  const owner = JSON.parse(await readFile(join(context.outputRoot, marker), "utf8"));
  if (owner.experimentId !== context.experimentId || owner.scenario !== context.scenario || owner.docsydeSha !== context.docsydeSha) throw new ReliabilityIsolationError("resource-owner");
}
export async function prepareOwnedRoot(context: ReliabilityContext) {
  await assertNoSymlink(context.outputRoot);
  await mkdir(dirname(context.outputRoot), { recursive: true, mode: 0o700 });
  try {
    await mkdir(context.outputRoot, { recursive: false, mode: 0o700 });
    await writeFile(join(context.outputRoot, marker), JSON.stringify({ version: 1, experimentId: context.experimentId,
      scenario: context.scenario, docsydeSha: context.docsydeSha, creatorPid: process.pid }), { flag: "wx", mode: 0o600 });
  } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
  await assertOwnedRoot(context);
  for (const directory of ["tmp", "artifacts", "reports", "sessions"]) {
    const path = join(context.outputRoot, directory); await assertNoSymlink(path); await mkdir(path, { recursive: true, mode: 0o700 });
  }
}
export async function ownedPath(context: ReliabilityContext, path: string) {
  await assertOwnedRoot(context);
  const absolute = resolve(path), subpath = relative(context.outputRoot, absolute);
  if (!subpath || subpath === ".." || subpath.startsWith(`..${sep}`) || subpath.startsWith(sep)) throw new ReliabilityIsolationError("resource-outside-scenario");
  await assertNoSymlink(absolute);
  return absolute;
}
export async function writeOwnedJson(context: ReliabilityContext, path: string, value: unknown) {
  const target = await ownedPath(context, path);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
}
export async function freshEvidence(context: ReliabilityContext, destination: string) {
  const target = await ownedPath(context, destination);
  // Even an empty existing target is refused: a previous attempt is never reused.
  try { await lstat(target); throw new ReliabilityIsolationError("evidence-exists"); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  const token = randomUUID(), staging = `${target}.pending-${token}`;
  await mkdir(staging, { mode: 0o700 });
  await writeFile(join(staging, marker), JSON.stringify({ experimentId: context.experimentId, scenario: context.scenario, token, creatorPid: process.pid }), { flag: "wx", mode: 0o600 });
  return { path: staging, target, token, async finalize(receipt: unknown) {
    await ownedPath(context, staging); await ownedPath(context, target);
    // Reserve target without replacement. No success marker exists until checks finish.
    await mkdir(target, { mode: 0o700 });
    await rename(staging, join(target, "evidence"));
    await writeFile(join(target, "offline-gate.json"), JSON.stringify(receipt, null, 2), { flag: "wx", mode: 0o600 });
  } };
}
export async function removeOwnedTemporary(context: ReliabilityContext, path: string, token: string) {
  const target = await ownedPath(context, path);
  const owner = JSON.parse(await readFile(join(target, marker), "utf8"));
  if (owner.experimentId !== context.experimentId || owner.scenario !== context.scenario || owner.token !== token) throw new ReliabilityIsolationError("cleanup-owner");
  // Node rm unlinks descendant symlinks; it never traverses their targets.
  // The removable root and every ancestor were checked above.
  await rm(target, { recursive: true, force: false });
}
export async function reserveAttempt(context: ReliabilityContext, phase: string, evidence: unknown) {
  if (!context.scenario || !/^[a-z-]+$/.test(phase)) throw new ReliabilityIsolationError("attempt-context");
  await writeOwnedJson(context, join(context.outputRoot, `${phase}.attempt.json`), { experimentId: context.experimentId, scenario: context.scenario, phase, evidence, creatorPid: process.pid, startedAt: new Date().toISOString() });
}
