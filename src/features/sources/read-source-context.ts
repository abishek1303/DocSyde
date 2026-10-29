import "server-only";
import { resolveRevision, readFileAtCommit, revisionInput, repositoryPathInput } from "@/integrations/github/source-reader";
import { SourceReadError } from "@/integrations/github/errors";
import { assertAllowedRepository, withSourceAccess } from "./local-source-access";
import { contextInput, type ContextFile, type SourceContext } from "./source-context";

export async function readSourceContext(raw: unknown): Promise<SourceContext> {
  const input = contextInput.parse(raw);
  // Validate the entire batch before any network access, using adapter-owned rules.
  revisionInput.parse(input.revision);
  const paths = [...new Set(input.paths.map(path => repositoryPathInput.parse(path)))];
  if (paths.length > 10) throw new Error("Select at most 10 unique source paths.");
  assertAllowedRepository(input.owner, input.repo);
  return withSourceAccess(async () => {
    const signal = AbortSignal.timeout(60_000);
    const commit = await resolveRevision(input, { signal });
    return readPinnedSourceContext({ ...input, paths, commitId: commit.commitId }, signal);
  });
}

// Caller owns concurrency; both workflows use this authorized pinned reader.
export async function readPinnedSourceContext(input: { owner: string; repo: string; revision: string; paths: string[]; commitId: string }, signal: AbortSignal): Promise<SourceContext> {
  assertAllowedRepository(input.owner, input.repo);
  const paths = input.paths.map(path => repositoryPathInput.parse(path));
  if (paths.length > 10) throw new Error("Select at most 10 unique source paths.");
  const repository = `https://github.com/${input.owner}/${input.repo}`;
  const files: ContextFile[] = [];
  let failed = false;
  for (let index = 0; index < paths.length; index += 2) {
    // Await both workers before releasing the process guard, including on failure.
    const batch = await Promise.all(paths.slice(index, index + 2).map(async path => {
      const metadata = { path, contentId: null, size: null, url: `${repository}/blob/${input.commitId}/${path.split("/").map(encodeURIComponent).join("/")}` };
      if (failed || signal.aborted) return { ...metadata, status: "error" as const, reason: "Not retrieved because the operation failed or exceeded its deadline." };
      try {
        const file = await readFileAtCommit({ owner: input.owner, repo: input.repo, commitSha: input.commitId, path }, { signal });
        const details = { ...metadata, contentId: file.contentId, size: file.size };
        if (file.status === "unsupported") return { ...details, status: "unavailable" as const, reason: file.reason };
        const size = Buffer.byteLength(file.text, "utf8");
        if (size > 64 * 1024) return { ...details, size, status: "excluded" as const, reason: "File exceeds the 64 KiB review budget; entire content excluded." };
        return { ...details, size, status: "available" as const, text: file.text };
      } catch (error) {
        if (error instanceof SourceReadError && error.code === "not-found") return { ...metadata, status: "unavailable" as const, reason: "Path not found or inaccessible at the pinned commit." };
        failed = true;
        return { ...metadata, status: "error" as const, reason: error instanceof SourceReadError ? error.message : "Source retrieval failed." };
      }
    }));
    files.push(...batch);
  }
  const bytes = files.reduce((sum, file) => sum + (file.status === "available" ? file.size ?? 0 : 0), 0);
  const budgetExceeded = bytes > 256 * 1024;
  const selected = budgetExceeded ? files.map((file): ContextFile => file.status === "available" ? {
    path: file.path, contentId: file.contentId, size: file.size, url: file.url,
    status: "excluded", reason: "Whole context exceeds 256 KiB. Select fewer or smaller files; no bundle contents returned.",
  } : file) : files;
  return { repository, requestedRevision: input.revision, commitId: input.commitId, files: selected, bytes,
    available: selected.filter(f => f.status === "available").length,
    unavailable: selected.filter(f => f.status === "unavailable" || f.status === "error").length,
    excluded: selected.filter(f => f.status === "excluded").length,
    complete: !budgetExceeded && selected.every(f => f.status === "available"), budgetExceeded,
    ...(failed || signal.aborted ? { error: "Source retrieval did not complete. Review file statuses and retry manually." } : {}) };
}
