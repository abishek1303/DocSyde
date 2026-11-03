import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";

function file(repository: string, directory: string) { return join(directory, `${createHash("sha256").update(repository.toLowerCase()).digest("hex")}.json`); }
export function runtimeSettingsDirectory() { return resolve(".artifacts/runtime-settings"); }
/** Local operator settings only, separate from generated understanding and evidence storage. */
export async function readRuntimeSettings(repository: string, directory = runtimeSettingsDirectory()): Promise<unknown | null> {
  try { return JSON.parse(await readFile(file(repository, directory), "utf8")); }
  catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null; throw error; }
}
export async function writeRuntimeSettings(repository: string, value: unknown, directory = runtimeSettingsDirectory()) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = file(repository, directory), temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}
