import "server-only";
import { z } from "zod";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { localUrl } from "./runtime";

const execute = promisify(execFile);
const text = z.string().trim().min(1).max(1024);
const optional = z.string().trim().max(1024).optional().transform(value => value || undefined);
export const managedStartupInput = z.object({
  repository: z.url(), checkout: text, directory: text.default("."),
  manager: z.enum(["npm", "pnpm", "yarn"]).optional(), script: optional,
  baseUrl: optional, workflowPath: text,
}).strict();
export const approvedStartup = z.object({ version: z.literal(1), input: managedStartupInput,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), approvedAt: z.iso.datetime(), enabled: z.boolean(),
}).strict();
export type ApprovedStartup = z.infer<typeof approvedStartup>;
export type StartupInput = z.input<typeof managedStartupInput>;
export class ManagedRuntimeUnavailable extends Error {
  constructor(public readonly code: "approval-required" | "dependencies-missing" | "package-manager-missing" | "project-dependencies-missing" | "port-occupied" | "startup-failed" | "readiness-timeout" | "unsupported-platform", public readonly executable?: "npm" | "pnpm" | "yarn") { super(`Managed runtime unavailable: ${code}`); }
}
function inside(root: string, path: string) {
  const local = relative(root, path);
  if (local === ".." || local.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(local)) throw new Error("Path must stay within its approved checkout.");
  return path;
}
async function boundedFile(path: string, limit: number) {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > limit) throw new Error("Configuration file exceeds its reading limit.");
    const bytes = Buffer.alloc(limit + 1); let size = 0;
    while (size < bytes.length) {
      const read = await file.read(bytes, size, bytes.length - size, size);
      if (read.bytesRead === 0) break;
      size += read.bytesRead;
    }
    if (size > limit) throw new Error("Configuration file exceeds its reading limit.");
    return bytes.subarray(0, size).toString("utf8");
  } finally { await file.close(); }
}

function githubIdentity(origin: string) {
  const normalized = origin.trim().replace(/^git@github\.com:/, "https://github.com/").replace(/^ssh:\/\/git@github.com\//, "https://github.com/").replace(/\.git$/, "").toLowerCase();
  const url = new URL(normalized);
  if (url.origin !== "https://github.com" || url.username || url.password || url.search || url.hash || url.pathname.split("/").length !== 3) throw new Error("Checkout must match the selected GitHub repository.");
  return url.href.replace(/\/$/, "");
}
/** Metadata only: no package scripts, hooks, tools or model calls are executed. */
export async function inspectCheckout(repository: string, checkoutPath: string, directory = ".") {
  const checkout = await realpath(checkoutPath);
  const env: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), NODE_ENV: process.env.NODE_ENV ?? "development" };
  const git = async (args: string[]) => (await execute("git", ["--no-pager", ...args], { cwd: checkout, env, timeout: 5000, maxBuffer: 16 * 1024 })).stdout.trim();
  if (await realpath(await git(["rev-parse", "--show-toplevel"])) !== checkout || githubIdentity(await git(["config", "--get", "remote.origin.url"])) !== githubIdentity(repository)) throw new Error("Checkout does not match the selected repository root.");
  if (isAbsolute(directory)) throw new Error("Working directory must be relative to the checkout.");
  const cwd = inside(checkout, await realpath(resolve(checkout, directory)));
  const manifestPath = inside(checkout, await realpath(join(cwd, "package.json")));
  const manifestText = await boundedFile(manifestPath, 64 * 1024);
  const manifest = z.object({ scripts: z.record(z.string(), z.string().max(10000)).default({}), packageManager: z.string().optional(),
    dependencies: z.record(z.string(), z.unknown()).optional(), devDependencies: z.record(z.string(), z.unknown()).optional() }).parse(JSON.parse(manifestText));
  if (Object.keys(manifest.scripts).length > 100) throw new Error("Too many scripts to review within the configuration limit.");
  const locks: { path: string; sha256: string }[] = [];
  for (const parent of [...new Set([checkout, cwd])]) for (const file of ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "pnpm-workspace.yaml"]) {
    try {
      const path = inside(checkout, await realpath(join(parent, file)));
      locks.push({ path, sha256: digest(await boundedFile(path, 2 * 1024 * 1024)) });
    } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
  }
  const manager: "npm" | "pnpm" | "yarn" = /^pnpm@/.test(manifest.packageManager ?? "") || locks.some(lock => lock.path.endsWith("pnpm-lock.yaml")) ? "pnpm" : /^yarn@/.test(manifest.packageManager ?? "") || locks.some(lock => lock.path.endsWith("yarn.lock")) ? "yarn" : "npm";
  const scripts = Object.keys(manifest.scripts).filter(name => /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,79}$/.test(name));
  const script = ["dev", "start", "serve"].find(name => scripts.includes(name)) ?? scripts[0];
  const command = manifest.scripts[script ?? ""] ?? "";
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  // A frontend command may run alongside an API with its own --port flag.
  const primaryCommand = "vite" in dependencies ? command.match(/\bvite[^"';&|]*/)?.[0] ?? "vite" : command;
  const port = primaryCommand.match(/(?:--port(?:=|\s+)|\bPORT=)(\d{2,5})/)?.[1];
  const baseUrl = `http://localhost:${port ?? ("vite" in dependencies ? 5173 : 3000)}`;
  return { checkout, directory: relative(checkout, cwd) || ".", cwd, scripts: manifest.scripts, scriptNames: scripts,
    suggested: { manager, script, baseUrl }, manifestHash: digest(manifestText), locks, needsDependencies: Object.keys(dependencies).length > 0 };
}
export function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
export async function reviewManagedStartup(raw: StartupInput) {
  const draft = managedStartupInput.parse(raw), checkout = await inspectCheckout(draft.repository, draft.checkout, draft.directory);
  const manager = draft.manager ?? checkout.suggested.manager;
  const script = draft.script ?? checkout.suggested.script;
  if (!script || !checkout.scriptNames.includes(script)) throw new Error("Select an existing package script.");
  const baseUrl = localUrl(draft.baseUrl ?? checkout.suggested.baseUrl);
  if (baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash) throw new Error("Expected URL must be a loopback origin without query parameters.");
  const appRoot = await realpath(process.cwd());
  const workflowPath = inside(appRoot, await realpath(resolve(appRoot, draft.workflowPath)));
  const workflowText = await boundedFile(workflowPath, 128 * 1024);
  const workflowRaw: unknown = JSON.parse(workflowText);
  const workflowRepository = z.object({ repository: z.string() }).parse(workflowRaw).repository;
  if (githubIdentity(workflowRepository) !== githubIdentity(draft.repository)) throw new Error("The trusted browser workflow belongs to another project.");
  const input = { ...draft, checkout: checkout.checkout, directory: checkout.directory, manager, script, baseUrl: baseUrl.origin, workflowPath: relative(appRoot, workflowPath) };
  const fingerprint = digest(JSON.stringify({ input, manifest: checkout.manifestHash, locks: checkout.locks, workflow: digest(workflowText) }));
  return { input, fingerprint, checkout, workflowRaw };
}
export async function verifyManagedStartup(raw: unknown) {
  const approval = approvedStartup.parse(raw);
  const reviewed = await reviewManagedStartup(approval.input);
  if (reviewed.fingerprint !== approval.fingerprint) throw new ManagedRuntimeUnavailable("approval-required");
  return { approval, ...reviewed };
}
export async function managedExecutable(manager: "npm" | "pnpm" | "yarn", checkout: string) {
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(path => path && isAbsolute(path))) {
    const candidate = join(directory, manager);
    try {
      await access(candidate, constants.X_OK);
      const resolved = await realpath(candidate);
      const local = relative(checkout, resolved);
      if (local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local)) continue;
      return resolved;
    } catch { /* Only installed package managers, never npx or installation fallbacks. */ }
  }
  throw new ManagedRuntimeUnavailable("package-manager-missing", manager);
}
