# Sources

Implemented: local GitHub revision comparison connected to the existing structured
AI capability. `summarizeChanges` owns allowlist authorization, single-process
concurrency, evidence selection, model instructions, and citation validation.
Routes/actions only adapt requests and render results. No database is needed.

The homepage accepts owner, repository, base, and head. Refs resolve to immutable
commits; base must be an ancestor of head. Every changed file remains in the
inventory. Claims cite exact excerpts from included patches. Expand citations and
file entries to inspect source evidence. Observations and possible effects are
separate; inference requires uncertainty. Citation matching proves traceability,
not semantic accuracy. Runtime behavior, deployment, and test success are unverified.

`DOCSYDE_ANALYSIS_REPOSITORIES` is a comma-separated server-side allowlist,
case-insensitive, defaulting to `abishek1303/DocSyde`. Set it to an empty string to
disable analysis. This is a trusted local-operator feature, not user authentication.
Bind Next to 127.0.0.1. Before public hosting or tunneling, add authentication,
per-user repository authorization, credential scoping, and distributed spend/rate
limits. The concurrency guard covers only this Node process.

Budgets: 100 commits, 30 files, 12 KiB per patch, 64 KiB serialized model evidence,
8,192 output tokens, 60-second GitHub deadline, 180-second overall deadline (model
transport retains its own 120-second ceiling). Oversized patches are excluded in
whole with explicit status; oversized comparisons/bundles fail without analysis.
Unavailable and supplied empty patches remain distinct. Commit messages/authors
are excluded from model input. File inventory is complete on success, but GitHub
patch completeness is not guaranteed. No full-file fetch, automatic retry,
background task, local-Git fallback, or runtime/capture orchestration occurs.
An empty comparison or absence of usable patches skips AI. Model/citation failure
retains evidence and displays an error without a generated summary.

Run `npm run sources:test` for regression and mocked connected tests.
`npm run sources:verify` makes a live GitHub-to-Baseten call using the documented
docs-only revisions. Optional arguments are base and head. It uses API credits.
See [SETUP.md](../../../SETUP.md) for commands and provider configuration.

## Review source context

Open `/sources/context` from the homepage. Enter owner, repository, one revision
(branch/tag/commit), and relative paths, one per line. The initial example reviews
the change-summary implementation at `cb08108`. Revision resolution happens once;
all files use the resulting immutable commit. Inspect expandable line-numbered
text, content IDs, byte sizes, and pinned GitHub links. Empty files are valid.

This uses `GITHUB_TOKEN` only: no AI calls, documentation generation, database, or
source persistence. Repository text is escaped, never executed as instructions.
The existing `DOCSYDE_ANALYSIS_REPOSITORIES` allowlist applies (default
`abishek1303/DocSyde`; empty disables access), and a single-process guard prevents
overlap with change summaries. Bind the local server to `127.0.0.1`; public access
requires authentication and user-specific repository authorization first.

Limits: 10 unique paths, 64 KiB UTF-8 text per displayed file, 256 KiB total, two
concurrent file reads, and a 60-second deadline. Oversized files are excluded in
whole. If the total exceeds budget, all available text is withheld and the user
must reduce the selection. Missing/unsupported files remain in the inventory.
Transport/auth/rate-limit failures mark the operation incomplete and stop later
batches; there are no automatic retries. Coverage concerns selected files only,
not the whole repository or unselected dependencies.

Run `npm run sources:context:verify` for the real pinned-file smoke test. Optional
arguments are a revision followed by paths. The CLI reports metadata without file
contents and exits nonzero for incomplete contexts. `npm run sources:test` includes
context regression tests; GitHub adapter checks remain in `npm run github:test`.
