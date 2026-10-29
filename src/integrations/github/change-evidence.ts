// Provider-neutral evidence, colocated with its first producer until another
// implementation needs it. These types deliberately have no SDK dependencies.
export type CommitEvidence = {
  commitId: string;
  message: string;
  author: string | null;
  committedAt: string | null;
};

export type FileChange = {
  path: string;
  previousPath: string | null;
  kind: "added" | "deleted" | "modified" | "renamed" | "copied" | "type-changed";
  additions: number;
  deletions: number;
  // null means unavailable; an empty string is an available, empty patch.
  patch: string | null;
};

export type ChangeEvidence = {
  repository: { location: string };
  base: CommitEvidence;
  head: CommitEvidence;
  commits: CommitEvidence[];
  files: FileChange[];
};

export type FileEvidence = {
  path: string;
  commitId: string;
  contentId: string;
  size: number | null;
} & (
  | { status: "available"; text: string }
  | {
    status: "unsupported";
    reason: "binary" | "too-large" | "symlink" | "submodule" | "directory" | "file-type";
  }
);
