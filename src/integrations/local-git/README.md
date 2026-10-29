# Local Git source evidence

`compareCommits({ repositoryPath, base, head })` and
`readFileAtCommit({ repositoryPath, commitId, path })` produce the existing plain
`ChangeEvidence` and `FileEvidence` types through type-only imports from GitHub's
current evidence file. No GitHub client/operations are imported or changed.

Git must be on PATH. No credentials or environment configuration is needed.
The adapter resolves revisions to immutable commits, requires base to be an
ancestor of head, and reads committed objects even when the working tree is dirty.
`repository.location` is a canonical local file URL. Commit order is reverse
topological (parents before children); GitHub and local patches/rename heuristics
can differ. No GitHub 300-file limit is imposed.

Git is invoked without a shell, external diff helpers, text conversion, or pagers.
Paths use NUL-delimited machine output and literal pathspecs. Commands have a
30-second/32-MiB limit and fail rather than silently truncate. File reads support
UTF-8 up to 1 MiB; binary files, links, submodules, directories, and oversized
content have explicit unsupported results. Binary patches are null and line
counts are zero where Git has no textual counts. `LocalGitError` reports local
command/limit, comparison, missing-file and input failures without dumping output.

```sh
npm run git:test
npm run git:verify -- . HEAD~1 HEAD --path README.md
```

No fetch, clone, checkout, working-tree comparison, writes, runner, or model calls.
Tests create and remove their own temporary repositories; the supplied repository
is never mutated.
