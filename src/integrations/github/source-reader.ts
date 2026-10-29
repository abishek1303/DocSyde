import "server-only";

import { z } from "zod";
import { createGithubClient, withGithubErrors } from "@/integrations/github/client";
import { SourceReadError } from "@/integrations/github/errors";
import type { ChangeEvidence, CommitEvidence, FileChange, FileEvidence } from "@/integrations/github/change-evidence";

const repositoryInput = z.object({
  owner: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/),
  repo: z.string().regex(/^[A-Za-z0-9_.-]+$/).refine((name) => name !== "." && name !== ".."),
});
export const revisionInput = z.string().min(1).max(1024).refine((value) =>
  !/[\s\x00-\x1f\x7f:]/.test(value) && !value.includes("..") &&
  !value.split("/").some((part) => part === "" || part === "."));
const compareInput = repositoryInput.extend({ base: revisionInput, head: revisionInput });
export const repositoryPathInput = z.string().min(1).refine((path) =>
    !/[\x00-\x1f\x7f\\]/.test(path) &&
    !path.split("/").some((part) => part === "" || part === "." || part === ".."));
const fileInput = repositoryInput.extend({
  commitSha: z.string().regex(/^[a-fA-F0-9]{40}$/),
  path: repositoryPathInput,
});

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new SourceReadError("invalid-input", "Provide a repository owner/name, valid revisions, and a repository-relative file path when reading a file.");
  }
  return result.data;
}

// Structural input stays internal: only our explicit neutral result types escape.
function commitEvidence(value: {
  sha: string;
  commit: {
    message: string;
    author: { name?: string } | null;
    committer: { date?: string } | null;
  };
}): CommitEvidence {
  return {
    commitId: value.sha,
    message: value.commit.message,
    author: value.commit.author?.name ?? null,
    committedAt: value.commit.committer?.date ?? null,
  };
}

const changeKinds: Record<string, FileChange["kind"]> = {
  added: "added", removed: "deleted", modified: "modified", changed: "type-changed",
  renamed: "renamed", copied: "copied",
};

function incomplete(message: string): never {
  throw new SourceReadError("incomplete-evidence", message);
}

export async function resolveRevision(input: { owner: string; repo: string; revision: string }, options: { signal?: AbortSignal } = {}): Promise<CommitEvidence> {
  const parsed = parseInput(repositoryInput.extend({ revision: revisionInput }), input);
  return withGithubErrors(async () => {
    const client = await createGithubClient(options.signal);
    const { data } = await client.rest.repos.getCommit({ owner: parsed.owner, repo: parsed.repo, ref: parsed.revision, per_page: 1 });
    return commitEvidence(data);
  });
}

export async function compareCommits(input: {
  owner: string; repo: string; base: string; head: string;
}, options: { maxCommits?: number; signal?: AbortSignal } = {}): Promise<ChangeEvidence> {
  const { owner, repo, base, head } = parseInput(compareInput, input);
  if (options.maxCommits !== undefined && (!Number.isSafeInteger(options.maxCommits) || options.maxCommits < 1)) {
    throw new SourceReadError("invalid-input", "Commit budget must be a positive integer.");
  }
  return withGithubErrors(async () => {
    const client = await createGithubClient(options.signal);
    const [baseResponse, headResponse] = await Promise.all([
      client.rest.repos.getCommit({ owner, repo, ref: base, per_page: 1 }),
      client.rest.repos.getCommit({ owner, repo, ref: head, per_page: 1 }),
    ]);
    const baseCommit = commitEvidence(baseResponse.data);
    const headCommit = commitEvidence(headResponse.data);
    const result: ChangeEvidence = {
      repository: { location: `https://github.com/${owner}/${repo}` },
      base: baseCommit, head: headCommit, commits: [], files: [],
    };
    if (baseCommit.commitId === headCommit.commitId) return result;

    const parameters = { owner, repo, basehead: `${baseCommit.commitId}...${headCommit.commitId}`, per_page: 100 };
    const { data: first } = await client.rest.repos.compareCommitsWithBasehead({ ...parameters, page: 1 });
    if (first.status !== "ahead" || first.merge_base_commit.sha !== baseCommit.commitId) {
      throw new SourceReadError("unsupported-comparison", "Base must be an ancestor of head. Reversed or diverged histories are not supported.");
    }
    if (!first.files || first.files.length >= 300) {
      incomplete("GitHub cannot establish a complete changed-file list for this comparison (300-file cap).");
    }
    result.files = first.files.map((file): FileChange => {
      const kind = Object.hasOwn(changeKinds, file.status) ? changeKinds[file.status] : undefined;
      if (!kind || (kind === "renamed" && !file.previous_filename)) {
        incomplete("GitHub returned an unsupported file change or omitted its previous path.");
      }
      return {
        path: file.filename, previousPath: file.previous_filename ?? null, kind,
        additions: file.additions, deletions: file.deletions, patch: file.patch ?? null,
      };
    });
    if (options.maxCommits !== undefined && first.total_commits > options.maxCommits) {
      throw new SourceReadError("incomplete-evidence", "Comparison exceeds the requested commit budget. Choose a narrower revision range.");
    }
    const commits = [...first.commits];
    if (!Number.isSafeInteger(first.total_commits) || first.total_commits < 1 || commits.length === 0) {
      incomplete("GitHub did not return a complete commit list.");
    }
    for (let page = 2; commits.length < first.total_commits; page++) {
      const { data } = await client.rest.repos.compareCommitsWithBasehead({ ...parameters, page });
      if (data.total_commits !== first.total_commits || data.commits.length === 0) {
        incomplete("GitHub returned an incomplete or inconsistent commit page.");
      }
      commits.push(...data.commits);
    }
    if (commits.length !== first.total_commits || new Set(commits.map((commit) => commit.sha)).size !== commits.length ||
      commits.at(-1)?.sha !== headCommit.commitId) {
      incomplete("GitHub returned an incomplete or inconsistent commit list.");
    }
    result.commits = commits.map(commitEvidence);
    return result;
  });
}

export async function readFileAtCommit(input: {
  owner: string; repo: string; commitSha: string; path: string;
}, options: { signal?: AbortSignal } = {}): Promise<FileEvidence> {
  const { owner, repo, commitSha, path } = parseInput(fileInput, input);
  return withGithubErrors(async () => {
    const client = await createGithubClient(options.signal);
    const { data: commit } = await client.rest.git.getCommit({ owner, repo, commit_sha: commitSha });
    let treeId = commit.tree.sha;
    const parts = path.split("/");
    for (const [index, part] of parts.entries()) {
      // Walk non-recursive trees: preserve modes and never follow symlinks.
      const { data: tree } = await client.rest.git.getTree({ owner, repo, tree_sha: treeId });
      if (tree.truncated) incomplete("GitHub returned a truncated directory listing.");
      const entry = tree.tree.find((candidate) => candidate.path === part);
      if (!entry?.sha) throw new SourceReadError("not-found", "File was not found at the requested commit.");
      const metadata = { path, commitId: commitSha.toLowerCase(), contentId: entry.sha, size: entry.size ?? null };
      const unsupported = (reason: Extract<FileEvidence, { status: "unsupported" }>["reason"]): FileEvidence =>
        ({ ...metadata, status: "unsupported", reason });
      if (entry.mode === "120000") return unsupported("symlink");
      if (entry.mode === "160000" || entry.type === "commit") return unsupported("submodule");
      if (entry.type === "tree") {
        if (index === parts.length - 1) return unsupported("directory");
        treeId = entry.sha;
        continue;
      }
      if (index !== parts.length - 1 || entry.type !== "blob" || !["100644", "100755"].includes(entry.mode ?? "")) {
        return unsupported("file-type");
      }
      if (entry.size === undefined || entry.size < 0) incomplete("GitHub omitted the file size.");
      if (entry.size > 1024 * 1024) return unsupported("too-large");
      const { data: blob } = await client.rest.git.getBlob({ owner, repo, file_sha: entry.sha });
      if (blob.encoding !== "base64" || blob.sha !== entry.sha) incomplete("GitHub returned unsupported file content.");
      const bytes = Buffer.from(blob.content, "base64");
      if (bytes.length !== entry.size || blob.size !== entry.size) incomplete("GitHub returned incomplete file content.");
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        return unsupported("binary");
      }
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) return unsupported("binary");
      return { ...metadata, status: "available", text };
    }
    return incomplete("GitHub did not resolve the requested file.");
  });
}
