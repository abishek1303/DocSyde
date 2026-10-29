import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { ChangeEvidence, CommitEvidence, FileChange, FileEvidence } from "@/integrations/github/change-evidence";
const execute = promisify(execFile);
export class LocalGitError extends Error {
  constructor(public readonly code: string) { super(`Local Git read failed: ${code}`); }
}
async function git(cwd: string, args: string[]): Promise<Buffer> {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LITERAL_PATHSPECS: "1", GIT_NO_REPLACE_OBJECTS: "1" };
  for (const key of Object.keys(env)) if (["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"].includes(key)) delete env[key as keyof typeof env];
  try { return (await execute("git", ["--no-pager", "-c", "core.quotePath=false", ...args], { cwd, env, encoding: "buffer", timeout: 30_000, maxBuffer: 32 * 1024 * 1024 })).stdout; }
  catch { throw new LocalGitError("command-failed-or-limit-exceeded"); }
}
async function repositoryRoot(repositoryPath: string): Promise<string> {
  const cwd = await realpath(repositoryPath);
  const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).toString().replace(/\r?\n$/, "");
  return realpath(root);
}

function filePathspecs(paths: string[]): string[] {
  // Literal pathspecs can still match directories. Exclude descendants so a
  // former filename that became a directory cannot pull unrelated files in.
  return paths.flatMap((path) => [
    `:(top,literal)${path}`,
    `:(top,exclude,glob)${path.replace(/[\\*?\[\]]/g, "\\$&")}/**`,
  ]);
}
async function resolveCommit(cwd: string, ref: string): Promise<string> {
  if (!ref || ref.startsWith("-") || /[\x00-\x20]/.test(ref)) throw new LocalGitError("invalid-ref");
  return (await git(cwd, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])).toString().trim();
}
async function metadata(cwd: string, id: string): Promise<CommitEvidence> {
  const [commitId, author, committedAt, ...message] = (await git(cwd, ["show", "-s", "--format=%H%x00%an%x00%cI%x00%B", id])).toString().split("\0");
  return { commitId, author, committedAt, message: message.join("\0").replace(/\n$/, "") };
}
export async function compareCommits(input: { repositoryPath: string; base: string; head: string }): Promise<ChangeEvidence> {
  const cwd = await repositoryRoot(input.repositoryPath);
  const base = await resolveCommit(cwd, input.base), head = await resolveCommit(cwd, input.head);
  if ((await git(cwd, ["merge-base", base, head])).toString().trim() !== base) throw new LocalGitError("unsupported-comparison");
  const ids = (await git(cwd, ["rev-list", "--reverse", "--topo-order", `${base}..${head}`])).toString().trim().split("\n").filter(Boolean);
  const names = (await git(cwd, ["diff", "--no-ext-diff", "--no-textconv", "--name-status", "-z", "--find-renames", base, head, "--"])).toString().split("\0");
  const files: FileChange[] = [];
  while (names[0]) {
    const status = names.shift()!; const first = names.shift()!;
    const previousPath = status.startsWith("R") || status.startsWith("C") ? first : null;
    const path = previousPath ? names.shift()! : first;
    const kinds: Record<string, FileChange["kind"]> = { A: "added", D: "deleted", M: "modified", R: "renamed", C: "copied", T: "type-changed" };
    const kind = kinds[status[0]];
    if (!kind || !path) throw new LocalGitError("unsupported-change");
    const paths = filePathspecs(previousPath ? [previousPath, path] : [path]);
    const stats = (await git(cwd, ["--no-literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--numstat", "-z", "--find-renames", base, head, "--", ...paths])).toString();
    const [added, deleted] = stats.split("\t");
    const patch = (await git(cwd, ["--no-literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--find-renames", "--unified=3", base, head, "--", ...paths])).toString();
    files.push({ path, previousPath, kind, additions: Number(added) || 0, deletions: Number(deleted) || 0, patch: added === "-" ? null : patch });
  }
  return { repository: { location: pathToFileURL(cwd).href }, base: await metadata(cwd, base), head: await metadata(cwd, head), commits: await Promise.all(ids.map((id) => metadata(cwd, id))), files };
}
export async function readFileAtCommit(input: { repositoryPath: string; commitId: string; path: string }): Promise<FileEvidence> {
  if (!/^[a-f0-9]{40}$/i.test(input.commitId) || !input.path || input.path.split("/").some((part) => !part || part === "." || part === "..") || /[\x00\\]/.test(input.path)) throw new LocalGitError("invalid-input");
  const cwd = await repositoryRoot(input.repositoryPath), id = await resolveCommit(cwd, input.commitId);
  const entry = (await git(cwd, ["ls-tree", "-z", id, "--", input.path])).toString().split("\0")[0];
  if (!entry) throw new LocalGitError("not-found");
  const [mode, type, contentId] = entry.split("\t")[0].split(" ");
  const result = { path: input.path, commitId: id, contentId, size: null as number | null };
  const unsupported = (reason: Extract<FileEvidence, { status: "unsupported" }>["reason"]): FileEvidence => ({ ...result, status: "unsupported", reason });
  if (mode === "120000") return unsupported("symlink");
  if (type === "commit") return unsupported("submodule");
  if (type === "tree") return unsupported("directory");
  if (type !== "blob") return unsupported("file-type");
  result.size = Number((await git(cwd, ["cat-file", "-s", contentId])).toString());
  if (result.size > 1024 * 1024) return unsupported("too-large");
  const bytes = await git(cwd, ["cat-file", "blob", contentId]);
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return unsupported("binary"); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) return unsupported("binary");
  return { ...result, status: "available", text };
}
