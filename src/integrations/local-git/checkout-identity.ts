import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export async function readCleanCheckoutIdentity(cwd: string) {
  const [head, status, files] = await Promise.all([
    exec("git", ["rev-parse", "HEAD"], { cwd }),
    exec("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd }),
    exec("git", ["ls-files", "-z"], { cwd, maxBuffer: 4 * 1024 * 1024 }),
  ]);
  if (status.stdout.trim()) throw new Error("Reliability freeze requires a clean committed checkout, including no untracked source files.");
  return { sha: head.stdout.trim(), files: files.stdout.split("\0").filter(Boolean) };
}
