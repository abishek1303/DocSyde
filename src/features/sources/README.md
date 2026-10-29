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

## Semantic product-change analysis

`analyzeProductChanges` owns the server-only workflow behind `/sources/analysis`:
comparison → pinned base/head context → bounded evidence → one structured model
call → local schema/citation validation. Existing summary/review screens remain.
The pinned-reader extraction shares retrieval logic without nested lock acquisition.
The existing repository allowlist and single-process guard apply. Keep the app
loopback-only; authentication/resource permissions are required before wider exposure.

`PRODUCT_CHANGE_EVIDENCE_BUDGET_BYTES` in `product-change-limits.ts` is the named
64 KiB limit on the actual serialized evidence payload. Existing patch selection
limits apply, with up to ten explicit context paths and two simultaneous file reads.
There is no silent truncation or automatic selection of extra files. Expected absent
sides for added/deleted files differ from unexpected missing context. All changed
files remain in the inventory. Endpoint context shares the comparison's pinned IDs.

Output starts with assessment product-change/internal-only/insufficient-evidence,
findings and uncertainties. No-change is deterministic and skips AI; limited-evidence
is separate coverage metadata and prohibits range-wide internal-only conclusions.
Missing/unsupported text can yield qualified findings; transport failures stop analysis.
Each citation has evidenceId, startLine, endLine and exact contiguous excerpt within that range. Patch
citations alone can suffice. Audience/surface are optional. New symbols do not prove
reachable behavior: capability claims require cited caller/route/configuration context.
Reference validation proves traceability, not semantic correctness or runtime behavior;
confidence is not calibrated probability. Review findings before downstream use.

Model output initially used 4,096 tokens. The real source-review comparison with two
context paths (42,658 evidence bytes) hit incomplete-output, so the configured budget
is 8,192. Evidence collection has a shared 60-second deadline and the operation a
180-second deadline; the model transport retains its 120-second ceiling. No retries,
repair loops, tools, persistence, docs generation or autonomous investigation are added.
Model/schema/citation failures show an error without generated findings, retaining
evidence. Untrusted source is separate from trusted instructions; commit messages
are excluded. Raw provider responses, credentials and source bodies are not logged.

`npm run sources:product:verify` defaults to cb08108 → e321954 with no extra paths;
append explicit context paths for surrounding code. The CLI prints evidence metadata
and validated analysis, not full source bodies. Run `npm run sources:test` for
regression/connected tests. Test fixtures are not demonstrations of real product changes.

Citation reliability: a larger-comparison failure quoted text from patch line 15
but cited line 14, confusing source coordinates with the extra patch hunk header.
The model payload now represents each entry with evidenceId and exact
[lineNumber, text] tuples, rather than N| prefixes in a multiline string. The
public citation contract and exact range/excerpt validation are unchanged; no
nearby-line search, fuzzy matching, citation rewriting, or repair call is added.
A regression rejects both that off-by-one reference and altered text. The existing
8,192-token output budget is retained. Numbered tuples count toward the same
64 KiB serialized-payload budget.

The docs-only and database comparisons previously returned valid internal findings
with limited, insufficient-evidence overall assessments. Citation validity remains
model-dependent: invalid output is withheld and manual retries can still fail.
Interactive browser verification remains blocked when local Browser Use is disabled.

Follow-up live check: cb08108 → e321954 with source-context page/form paths
passed schema and citation validation in two independent single-call runs (14
validated citations total; 45,529 evidence bytes each). A fresh old-format baseline
also passed, so these small samples do not establish a statistical reliability rate.
