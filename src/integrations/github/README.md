# GitHub source inspection

Implemented: read-only repository comparisons and pinned source-file reads through
Octokit. GitHub is one source-control provider, not the core DocSyde source-change
abstraction. This integration describes source changes; it does not interpret
product meaning or decide which documentation to update.

## Credentials

Set `GITHUB_TOKEN` in the ignored root `.env`, or in the process environment. A
fine-grained token restricted to the intended repositories with **Contents: read**
is the recommended minimum setup. Any token GitHub accepts with the necessary
access is supported; runtime code does not assume a token type. Organization
approval or SSO policies can also affect access. No token is needed for the
homepage, build, or mocked tests. Never put this token in `NEXT_PUBLIC_*` variables.

The CLI reads `.env` and respects existing environment variables. Next.js can also
load `.env.local`; keep any GitHub override consistent if using both environments.

## Operations and evidence

`source-reader.ts` exposes:

- `compareCommits({ owner, repo, base, head })`: resolve same-repository refs to
  immutable commit IDs, then return `ChangeEvidence`.
- `readFileAtCommit({ owner, repo, commitSha, path })`: read a repository-relative
  file at a full 40-character commit ID, returning `FileEvidence`.

`change-evidence.ts` contains plain TypeScript result types with no Octokit imports.
They use `commitId`, `contentId`, `path`, `previousPath`, normalized change `kind`,
line counts, and patch/text evidence. Repository `location` is a string; it contains
a GitHub URL for this provider but does not require GitHub coordinates in the type.
Author is a nullable display name, not a GitHub account object. Dates are nullable
ISO strings. File kinds are `added`, `deleted`, `modified`, `renamed`, `copied`, or
`type-changed`. Provider statuses and payloads stay inside the adapter.

Types remain colocated with their first producer. A future local Git implementation
can produce equivalent values without emulating GitHub JSON; there is no provider
interface, registry, or runner implementation yet.

### Completeness and limits

- Base must be an ancestor of head. Identical endpoints return empty lists.
  Behind/diverged histories are rejected to avoid confusing merge-base patches
  with direct endpoint differences.
- Successful comparisons contain the complete chronological intervening commit
  list and changed-file list. Commit pages are fetched and checked for consistency.
  No file-extension filtering is applied.
- GitHub only returns up to 300 changed files for a comparison. Results with 300
  or more files are conservatively rejected, even when exactly 300 might be complete.
- `patch: null` means GitHub did not supply a patch; `patch: ""` is a supplied empty
  patch. Available patches are preserved as supplied, not guaranteed to contain
  every line of a file's change. Missing patches do not prove binary content. Use
  pinned file reads for additional context. See [GitHub comparison limits](https://docs.github.com/en/rest/commits/commits#compare-two-commits).
- File reads support regular UTF-8 text up to 1 MiB, including empty files. Invalid
  UTF-8 or binary control characters produce an unsupported `binary` result.
  Oversized files, symlinks, submodules, directories, and unsupported file types
  produce explicit unsupported results without text. Git trees are walked without
  following symlinks; truncated directory listings fail explicitly.
- For a rename, read `previousPath` at base and `path` at head. Added files have no
  base content; deleted files have no head content. A missing file returns a typed
  `not-found` error rather than fabricated empty text.
- Each request has a 30-second abort deadline. Automatic retries are disabled.
  Use canonical repository coordinates; redirects fail rather than forwarding
  authentication to another URL.

`SourceReadError` exposes a code, sanitized message, and optional
`retryAfterSeconds` for rate limits. Invalid input, missing credentials, denied
access, missing resources, rate limits, timeouts, unsupported comparisons,
incomplete evidence, and other upstream failures are distinguished. Provider
request objects and credentials are never returned or logged.

## CLI proof

From the repository root:

```sh
npm run github:verify -- abishek1303 DocSyde 40bd71f8adb0a8380f0de20ff65aa6915fb7654c 78695f525dce698832c9ef9dbdb4109dd86fdd9c --path hackathon.md
npm run github:test
```

These existing commits demonstrate the addition of the hackathon guide. They must
be accessible on the remote to the configured token. General usage:

```sh
npm run github:verify -- <owner> <repo> <base> <head> [--path <path>]
```

The CLI prints `{ comparison, file? }` as JSON. `--path` reads at the resolved head,
not the possibly moving input ref. Diagnostics go to stderr and failures exit
nonzero. For stdout containing only JSON, use `npm run --silent github:verify -- …`.
No repository writes, database, app server, or model credentials are involved.

This is a trusted local CLI proof, not a user-authorized API. Project/resource
authorization belongs in feature operations before any future user-facing exposure.
