import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { reliabilityContext } from "@/integrations/reliability/execution-context";
import { reliabilityEnvironment } from "@/integrations/reliability/subprocess-environment";
const exec = promisify(execFile);
export async function readCleanCheckoutIdentity(cwd: string) {
  const context = reliabilityContext();
  const options = context ? { cwd, env: reliabilityEnvironment(context, process.env.DOCSYDE_RELIABILITY_CONTEXT!, "tools"), timeout: 10_000 } : { cwd };
  const [head, status, files, top] = await Promise.all([
    exec("git", ["rev-parse", "HEAD"], options),
    exec("git", ["status", "--porcelain", "--untracked-files=normal"], options),
    exec("git", ["ls-files", "-z"], { ...options, maxBuffer: 4 * 1024 * 1024 }),
    exec("git", ["rev-parse", "--show-toplevel"], options),
  ]);
  if (context && resolve(top.stdout.trim()) !== resolve(cwd)) throw new Error("Reliability requires the repository root.");
  if (status.stdout.trim()) throw new Error("Reliability freeze requires a clean committed checkout, including no untracked source files.");
  return { sha: head.stdout.trim(), files: files.stdout.split("\0").filter(Boolean) };
}
