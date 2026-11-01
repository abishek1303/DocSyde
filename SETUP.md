# Working setup notes

Living document: update this as we build. Last updated October 31, 2026.
For architectural decisions, use [ARCHITECTURE.md](ARCHITECTURE.md).

## Targeted documentation transformation

```sh
npm run db:migrate
npm run documentation:transform:test
npm run documentation:transform:persistence:test
# Explicit paid opt-in, with trusted full ProductImpact / optional plan JSON:
npm run documentation:transform:verify -- <impact.json> [plan.json]
```

Migration `0005_nice_meggan.sql` lets the existing immutable JSONB table accept
canonical v1 and v2. It changes no saved rows and adds no tables. V1 remains valid;
v2 preserves historical and current evidence comparisons across revisions. Existing
`db:setup` applies the migration for fresh/local setups. No new environment variables
or dependencies are required. The CLI uses existing `DATABASE_URL`/`BASETEN_API_KEY`;
omitting the plan adds one existing planning call. It never repeats source analysis.

Normal transformation cost is one generation call plus one new-wording support check.
Deterministic minimum batching handles large required context: 32 KiB per request,
128 KiB aggregate generation input, at most eight generation calls plus one check.
No-change/unresolved make no transformation/support calls. There are no repair loops.
Outputs retain every decision and distinguish incomplete generation/support, review
readiness, canonical save compatibility and approval. Ordinary revisions produce
self-contained v2 candidates; ambiguous placement/conflicts/limits remain explicit.

The verifier writes a private review artifact under ignored
`.artifacts/documentation-transformations/`, printing only identity/status/call counts.
These artifacts contain private documentation/evidence; keep them local. Failure or
partial proposals exit nonzero. The support check is fallible and covers only new
wording; retained historical content is not reverified. Transformation does not
approve, sign, save, publish, change run records or replace contextual publications.
See the [Documentation guide](src/features/documentation/README.md#targeted-transformations-and-canonical-v2)
for contracts, provenance, conservative internal-only rules and remaining scope.

## Runtime visual evidence

The local slice now supports one scripted workflow → stored checkpoints → sanitized
summary → one text selection → up to three vision analyses → existing product-impact
synthesis → existing documentation-impact planning. It does not change the run UI,
generate replacement documentation, save drafts or publish anything.

```sh
npx playwright install chromium
npm run runtime:visual:test
# Explicit opt-in: spends provider credit; run once with reviewed local inputs.
npm run runtime:visual:verify -- <trusted-workflow.json> <complete-source-result.json>
```

Use `infra/local/runner/visual-workflow.example.json` as the configuration shape;
replace its route/steps with your real product workflow. The second file must be
the complete server-produced `ProductResult`, including evidence text and validated
citations, from `analyzeProductChanges`. The existing source verifier deliberately
prints reduced evidence metadata, so its console output is not this handoff.
These are trusted local files, not authenticated client evidence. Never commit
credentials, user-entered values or private source/configuration files.

Set `DOCSYDE_STORAGE_DIRECTORY`, `BASETEN_API_KEY`, and `META_API_KEY` using the
existing [storage configuration](src/integrations/storage/storage.ts) and
[AI](src/integrations/ai/README.md) conventions. Existing `DATABASE_URL` and migrated
local PostgreSQL are needed only for the final planner's saved-document read.
No migration is added. The CLI writes trace/result/impact/plan JSON as ordinary
artifacts and prints opaque references plus status, never executable configuration.
Incomplete analysis exits nonzero and blocks synthesis/planning; zero budget records
local capture then stops without inference. Provider/planning failures also exit
nonzero. Existing immutable document candidates are never modified.

`maxSelectedScreenshots` accepts 0–3, default 3. A normal accepted run makes one
selection text call, 0–3 vision calls, one impact-synthesis text call and one
documentation-planning text call. Supplied source analysis is not regenerated.
Skip still permits source-only synthesis/planning; disabled/incomplete does not.
Local limits default to 12 checkpoints, 32 states, 32 MiB buffered image bytes and
120 seconds. See [browser capture](src/integrations/browser/README.md) for masking,
crop options, coverage, configurable ceilings and controlled-data limitations.
Selection/vision treat inspected instructions as data; no prompt-injection model
or continuous inference is introduced.

Slice verification: real Chromium workflow/masking tests and mocked-provider
selection/vision/synthesis/planning tests pass, together with Browser, Runner,
Storage, Sources, AI/Vision, Documentation, GitHub, local Git and SDK suites.
Existing PostgreSQL-backed run/context/persistence/publication suites also pass.
Lint, route type generation, TypeScript and `npm run build -- --webpack` pass.
Default Turbopack build hits the environment's local worker-port `EPERM` restriction.
No new paid model calls were made; provider factual quality remains unverified for
this combined path. Historical audit results below describe earlier checks.

## What runs where

- Your machine runs the Next.js app, local Git operations, the runner, and Playwright.
- Docker Compose runs PostgreSQL only. It does not start Next.js or the runner.
- GitHub supplies remote source evidence; Baseten hosts the model.
- The application being documented runs locally for browser capture. The SDK can
  register explicit route/feature context inside that application.

These capabilities are implemented independently. The homepage now connects GitHub comparison evidence to structured AI summaries.
Structured documentation drafts can be generated, previewed, explicitly saved to
PostgreSQL, and reopened without model calls. Publishing and contextual delivery remain unimplemented.

## Local artifact storage

The independent server-only storage boundary exposes `store(bytes)` and `read(key)`
through `getArtifactStorage()` in `src/integrations/storage/storage.ts`.
Set `DOCSYDE_STORAGE_DIRECTORY=.artifacts/storage` in `.env` or the process environment.
Configuration is read only when obtaining storage; relative paths resolve once
against that process's working directory. No configuration is needed to render the app.

The local adapter creates the trusted root recursively on the first store, creates
private files exclusively, and returns opaque UUID v4 keys to persist. Reads return
bytes or `null` only for an absent artifact; a missing root, permissions, collisions,
symlinks and nonregular files remain errors. Keep the directory outside `public/`
and preserve it to keep stored keys usable. To reset demo data, manually remove only
the configured artifact directory when its contents are no longer needed.
Browser capture accepts an explicit `ArtifactStorage` and returns
`screenshot.artifactKey` with its PNG hash and MIME type. The capture verification
CLI loads `.env` and uses configured storage. `outputDirectory` controls only
`evidence.json`; no screenshot file is written there. See the
[capture guide](src/integrations/browser/README.md) for ordering and failure behavior.

Run `npm run storage:test` for isolated temporary-directory tests. These do not load
developer `.env` or require any external service.

## Independent Meta vision proof

Set `META_API_KEY` and `DOCSYDE_STORAGE_DIRECTORY` in ignored `.env`.
Vision defaults to `muse-spark-1.3`; `META_VISION_MODEL` is an optional override.
Vision uses Meta Model API directly;
Baseten remains the text/semantic provider, with no fallback between them.
Run `npm run ai:vision:test` for mocked tests, or explicitly run
`npm run ai:vision:verify -- <artifact-key> 'Describe visible form controls.'`
to analyze one existing stored PNG with exactly one model request. No configuration
is needed for rendering/tests. See the [AI guide](src/integrations/ai/README.md#independent-screenshot-vision-analysis)
for limits, normalized bounds, uncertainty and errors. Evidence is returned only;
vision is not connected to the runner or application workflows.

## First setup

The app theme uses the Docsyde Figma foundations in `src/app/globals.css`, mapped
to the existing shared UI tokens. Inter and IBM Plex Mono load through
`next/font` in the root layout. The header light/dark toggle saves `docsyde-theme` in local storage and restores
it before the page paints. With no saved choice, the app uses the light theme;
Figma token changes must be reflected in CSS explicitly (there is no live sync).

Requirements: Node.js 20.9+, npm, Git, and Docker Desktop for PostgreSQL.
Browser checks also need Playwright's Chromium.

From the repository root:

```sh
npm ci
npx playwright install chromium
```

For a new checkout without `.env`, copy `.env.example` to `.env`. If `.env` already
exists, merge missing settings into it; do not overwrite existing credentials.

- `GITHUB_TOKEN`: fine-grained token for the repository to inspect, with
  **Contents: read-only**. Start with `abishek1303/DocSyde` for the example below.
- `BASETEN_API_KEY`: your Baseten key.
- `BASETEN_MODEL`: defaults to `meta-models/muse-spark-open-1026` when unset.
- `DOCSYDE_DRAFT_SIGNING_KEY`: at least 32 random characters for preview → save;
  generate locally with `openssl rand -hex 32`. Not needed to load saved drafts.
- PostgreSQL settings: keep `DATABASE_URL`, `POSTGRES_*`, and `COMPOSE_FILE`
  consistent with `.env.example`. See [local infrastructure](infra/local/README.md).

Keep credentials in the ignored `.env`; do not put them in `NEXT_PUBLIC_*` values.
The verification CLIs read `.env`; Next.js can also use `.env.local`, so avoid
conflicting settings between them.

Start Docker Desktop, then set up PostgreSQL:

```sh
npm run db:setup
```

Start the Next.js app in a separate terminal:

```sh
npm run dev
```

Open [localhost:3000](http://localhost:3000). The current homepage does not require
provider credentials. Compilation of the existing Google fonts needs network access.

## Check the integrations

These are command-line checks of real modules, not the combined product workflow.
GitHub/model checks do not need the app server or database running.

GitHub: compare two existing remote commits and read a file at head:

```sh
npm run github:verify -- abishek1303 DocSyde 40bd71f8adb0a8380f0de20ff65aa6915fb7654c 78695f525dce698832c9ef9dbdb4109dd86fdd9c --path hackathon.md
```

Arguments are owner, repository, base, head, and optional file path. Revisions can
be remote branch names, tags, or commit hashes; base must be an ancestor of head.
Expect commit metadata, changed files/patches, and the requested file contents.
This example reports `AGENTS.md` modified and `hackathon.md` added.

Baseten: make a real model call and validate the JSON result:

```sh
npm run ai:verify
```

Expect `data.receiptId` to be `proof-123`, plus model and elapsed-time fields.
This uses API credit; it does not analyze Git changes yet.

Baseten Management API billing tooling is not included; the supplied inference key does not support it. Inference billing errors are still reported. Check credits in the provider dashboard.

Other independent checks:

| Command | What it checks |
| --- | --- |
| `npm run git:verify -- . HEAD~1 HEAD --path README.md` | Local committed changes and a pinned file read; requires at least two commits |
| `npm run runner:verify -- infra/local/runner/example.json` | Starts a small fixture, waits for readiness, prints its description, then stops it |
| `npm run runner:capture:verify -- path/to/runner.json path/to/capture.json` | Launches/attaches, waits for readiness, captures through configured artifact storage, then stops the session before printing evidence |
| `npm run sdk:verify` | Builds the browser SDK and checks context registration/cleanup in Chromium |
| `npm run capture:test` | Captures a temporary test app; no separately started host app needed |
| `npm run capture:verify -- infra/local/capture/example.json` | Captures the app at localhost:3000; start it separately first |
| `npm run db:verify` | Creates and reads a verification project; leaves one record in PostgreSQL |

Automated suites: `npm run github:test`, `npm run ai:test`, `npm run git:test`,
`npm run runner:test`, `npm run sdk:test`, and `npm run capture:test`.
`npm run runner:capture:test` checks the combined lifecycle with isolated artifacts.
For the combined verifier, configure `DOCSYDE_STORAGE_DIRECTORY`; the runtime URL
overrides any capture JSON URL. The plain runner fixture needs capture JSON `{}`,
without the browser example's `h1` selector. See the
[runtime guide](src/runner/runtime/README.md#combined-local-capture-proof).
`ai:verify` calls Baseten; `ai:vision:verify` calls Meta against a stored PNG.
`ai:test` and `ai:vision:test` use mocked responses.
See the [integration guides](README.md#independent-capability-proofs) for limits.

## Current rough edges

- Runner cleanup owns only the direct child. Use an explicit executable; wrappers
  that start descendants need care. See the [runtime guide](src/runner/runtime/README.md).
- Screenshots, capture manifests, and compiled SDK output go under ignored `.artifacts/`.
- Browser checks require permission to launch Chromium and bind local ports.
- Turbopack builds have encountered port-binding restrictions in the agent environment.
  A webpack build has passed; `npm run build -- --webpack` is the fallback to try.
- The combined static/runtime reasoning loop, targeting existing documentation and
  content updates remain unimplemented. Explicit publication and narrow SDK delivery
  are implemented; see the publication instructions below and [MODEL_USAGE.md](MODEL_USAGE.md).

## Local change summaries

Run `npm run dev -- --hostname 127.0.0.1` and open http://127.0.0.1:3000.
Enter repository owner/name and ancestor base/head revisions, then Analyze changes.
GitHub and Baseten credentials are required only when running analysis; PostgreSQL
is unnecessary. The initial allowed repository is `abishek1303/DocSyde`. Override
with server-only `DOCSYDE_ANALYSIS_REPOSITORIES` (comma-separated); an empty value
disables analysis. Never expose this trusted local interface through a public host
or tunnel without authentication and per-user repository authorization.

The UI separates observed source changes from possible effects, shows pinned
commits and evidence coverage, and expands citations and file patches. Missing or
oversized patches are explicit; supplied patches are not guaranteed complete.
Citation matching establishes traceability, not semantic accuracy. Source patches
are sent to the hosted model. Results are not persisted.

Checks: `npm run sources:test`; live smoke: `npm run sources:verify`. The live
command defaults to base `40bd71f8adb0a8380f0de20ff65aa6915fb7654c` and head
`78695f525dce698832c9ef9dbdb4109dd86fdd9c`. For the existing database application-code
comparison use `npm run sources:verify -- 4cf816fc9e4b9cc644228db3f3156b0c3e46bdb1 40bd71f8adb0a8380f0de20ff65aa6915fb7654c`.
These commands use API credits. See the [Sources guide](src/features/sources/README.md)
for budgets, failure behavior, and local access limitations.

## Review source context

Open http://127.0.0.1:3000/sources/context (linked from the homepage) to select
a revision and up to 10 file paths. The screen displays pinned source contents,
content IDs, and explicit coverage. It uses the existing GitHub credentials and
repository allowlist, with no AI calls, database, or persistence.

Run `npm run sources:context:verify` for the live example at `cb08108`; optional
arguments are a revision followed by paths. See the [Sources guide](src/features/sources/README.md#review-source-context)
for budgets, unsupported content, local access restrictions, and failure behavior.

## Semantic product-change analysis

Open `/sources/analysis` (linked from Sources) to interpret original Git evidence
and selected pinned source context. Findings separate product behavior, internal
changes, and insufficient evidence, with confidence, qualifications, and exact
line citations. No generated summary is used as input. No results are persisted.
Run `npm run sources:product:verify -- <base> <head> [context-paths...]` for a live
check using the existing GitHub/Baseten credentials and local repository allowlist.
See the [Sources guide](src/features/sources/README.md#semantic-product-change-analysis)
for budgets, validation limits, and failure handling.

## Proposed structured documentation drafts

Open `/documentation/draft` from semantic analysis. Fresh runs perform analysis
then one draft-generation call using existing GitHub/Baseten credentials. The UI
shows rendered sections, server-preserved qualifications, canonical JSON and
block-to-finding-to-citation provenance. Saving is explicit; nothing is published.
Run `npm run documentation:test` or the credit-using `npm run documentation:verify`.
See the [Documentation guide](src/features/documentation/README.md) for the v1
model, limits, grounding checks, renderer restrictions and deferred work.

## Persisted documentation drafts

Run `npm run db:setup` to apply the additive draft migration. Configure the signing
key above before generating a preview you want to save. On `/documentation/draft`,
generate once, inspect, then choose **Save draft**. Save failures can be retried
without regenerating. Rotating the key invalidates old unsaved handoffs; persisted
drafts remain readable. Existing Projects data and the Docker volume are preserved.

Open `/documentation/drafts` to list and reopen saved drafts. This requires only
`DATABASE_URL` and PostgreSQL: no signing key, GitHub token or model credentials.
Drafts are immutable and remain unreviewed. These routes share the existing trusted
local-demo scope; do not expose them publicly without resource authorization.

`npm run documentation:persistence:test` runs isolated PostgreSQL tests, cleans up
only its own fixture IDs, and verifies save/load/list/render with external HTTP
disabled and provider credentials absent. `npm run documentation:persistence:verify`
leaves one clearly labeled verification draft for inspecting the actual routes;
rerun with `-- <id>` after a restart to reopen it without creating another row.
See the [Documentation guide](src/features/documentation/README.md#persistence-and-signed-saving).

## Documentation reader styling

The draft reader uses the installed shadcn Card styles and Tailwind utilities.
Tailwind compiles through `postcss.config.mjs` for both Next.js bundlers, including
the webpack fallback. Source/confidence details and canonical JSON are expandable;
assumptions and uncertainties remain visible in the document. Existing saved drafts
use this reader immediately, with no regeneration or database migration.

The saved-document help center uses shadcn’s neutral dark theme, a document sidebar
with a filter over the latest loaded titles, and section navigation. Mobile navigation
is collapsible. The generation prompt favors task-oriented help; analysis may retain
up to four focused findings with supported UI labels. Existing documents remain unchanged;
use a fresh generation to evaluate the updated writing instructions.

Repository context: the draft screen offers an optional saved product note (500
characters) and optional run note (300). Sources owns the setting; narrow Drizzle
queries store it in `docsyde.repository_contexts` (migration 0002). Provider
coordinate validation/location and access checks share trimmed, case-insensitive
GitHub identity. Existing draft provenance is never rewritten. Empty notes become
null; nonempty notes retain their exact whitespace. With no DATABASE_URL configured,
no repository context exists; database read failures otherwise remain explicit.
A frozen pair is read once before analysis and passed separately as advisory data
to both calls under unchanged budgets. New draft generation metadata records both
values (or null); historical drafts retain absent fields. Saving run context never
updates the repository setting. Save/update/clear use explicit controls; selection
changes discard stale form responses. Context cannot establish behavior or bypass
citations. Reopening a draft reads only historical JSON. Run
`npm run documentation:context:test` for isolated PostgreSQL/mocked-provider checks.
These tests establish plumbing and boundaries, not universal factual correctness.

Evidence-validation rejections retain local diagnostics under ignored
`.artifacts/semantic-analysis-rejections/<uuid>.json`: exact serialized semantic
input (including immutable SHAs, source mappings and advisory snapshots), parsed
model output and fixed validator rejection metadata. Successful runs and provider
failures create no diagnostic files. Transport headers, credentials and provider
envelopes are not captured. Files contain private repository source/user text;
keep them local and delete when no longer needed. Files use owner-only permissions.
Diagnostic write failure leaves the original rejection unchanged and emits a fixed
warning; there is no retry, product evidence ingestion or diagnostic UI.

## Product navigation (Slice 1)

`/` is the repository overview, `/docs` lists saved unreviewed drafts, and
`/changes` shows GitHub commits in pages of 10. Source analysis remains at `/sources`
with the existing context, semantic analysis, and draft-generation tools linked there.
Use `?repository=owner/name&branch=branch-name` to select an allowed repository and
GitHub branch. Omitting the branch resolves GitHub's default branch; this does not
represent the local checkout. A branch picker and per-commit analysis setup are available.
GitHub and database failures render independently. Saved-document filtering happens
in SQL before cursor pagination, using existing provenance; no migration is needed.
Run the new checks with `node --conditions=react-server --import tsx --test
src/integrations/github/browse.test.ts` and, with local PostgreSQL running,
`node --conditions=react-server --import tsx --test
infra/local/documentation/repository-scope.test.ts`.

Documentation entry: `/docs` opens the first available saved draft in the existing
reader. Repositories without saved drafts show Getting started with links to changes
and source tools. The full draft library remains at `/docs?view=library` and is linked
from the reader. Repository-scoped pagination is unchanged.

Saved-draft readers share a persistent layout: document switches keep the header,
sidebar filter and mobile navigation mounted. Only the article area shows its loading
skeleton. Navigation metadata loads independently through a scoped server action.

The application header now lives in the root layout, so Overview, Changes,
Documentation, source tools and the theme toggle remain visible across routes,
including saved-document navigation. The header stays pinned while scrolling.

Recent changes uses a commit table with GitHub-backed Previous/Next pagination.
`/changes?page=2` selects a page. Pages always show up to 10 commits.
Previous/Next controls sit in the table header and retain repository/branch selection. The overview retains its compact four-commit preview. On mobile, author
and date appear beneath the commit title to keep the table readable without overflow.


## Analyze a change and retain a proposal

Apply existing migrations through **0006** using `npm run db:migrate`. This run slice
requires no new migration. Start one local Next.js Node process (`npm run dev`, or
`npm run build -- --webpack` then `npm start`). PostgreSQL must be available.
GitHub/Baseten configuration and repository allowlisting remain unchanged; a draft
signing key is not required for schema-v2 runs.

Start from `/changes`, select the pinned comparison and create a run. The execute POST
returns **202** after admission; its process-local task continues after client disconnect.
Status polling exposes real persisted stages. Another active run gets **409 busy**;
there is no queue. Cancel uses a same-origin POST and propagates persisted cancellation.
Do not run multiple Next.js processes against this demo execution boundary.

New runs perform source → optional runtime → impact → plan → conditional transformation
→ retained proposal. They never generate a legacy direct v1 draft or automatically
approve/save/publish. Historical runs and standalone `/documentation/draft` remain
readable/available. New retained proposals cannot enter the legacy signed-save form.
Open the retained proposal to explicitly approve/reject each change and save reviewed changes. Saving does not publish; open a saved document for explicit Publish/Replace. The [review CLI](#proposal-review-proof) remains available for operator use. Initial expiry remains 24 hours.

Optional runtime configuration: set server-only `DOCSYDE_RUN_RUNTIME_CONFIG` to an
operator-managed JSON file. Use the existing visual-workflow example shape and add:

```json
{
  "repository": "https://github.com/owner/repo",
  "id": "request-form",
  "version": "1",
  "supportedPathnames": ["/requests/new"]
}
```

These fields extend the complete existing runtime/workflow/description/image-budget
configuration; this fragment alone is not executable. Configure `META_API_KEY`, local
Chromium and `DOCSYDE_STORAGE_DIRECTORY` for inspection. Launch/attach remains loopback
only, startup is bounded to 60 seconds, and one trusted workflow must cover all requested
targets. Secrets/actions/selectors never come from HTTP or inspected repository text.
Run JSONB stores only a safe configuration descriptor/hash and artifact references.

Missing/disabled workflow or unavailable capability/storage records **unavailable**
with decision **not evaluated**. Semantic **not-needed** is separate. Requested targets
outside trusted coverage record **requested-but-uncovered**. Those paths may continue
source-only with explicit downstream limitations; insufficient grounding finishes
incomplete. Attempted runtime failure stops synthesis. No partial visual evidence is
silently accepted. Empty comparison is successful `no-source-differences` with zero
calls, distinct from planner-derived `documentation-unchanged`.

Execution heartbeats every 10 seconds and checks cancellation every 2 seconds.
Renewal failure for 30 seconds aborts expensive work. Initialization, pre-start and
15-second maintenance reconciliation persist interruption after a 60-second stale
heartbeat when there is no matching local owner. Ordinary subsequent status reads
are read-only. A fresh running row after restart temporarily blocks new admission.
An independent 40-minute application deadline bounds work, not HTTP lifetime.
**Process death can interrupt runs; abrupt death cannot guarantee runtime cleanup.**
There is no automatic resume. Explicit new attempts before retention can repeat paid
calls. Completed retained runs reopen without inference, and retention/linkage commit
atomically. A retention failure never claims awaiting review.

Run `npm run documentation:runs:test` for the deterministic PostgreSQL/mocked-provider
proof, including real Chromium. It uses isolated fixture rows/artifacts and cleans up
its own state. [MODEL_USAGE.md](MODEL_USAGE.md) lists conditional calls (typical 5–10,
worst bounded 17); review/save remain model-free. Polished UI, streaming and MCP remain
future slices.

## Publish saved documentation into Request Desk

Run `npm run db:migrate` for additive migration 0004. Set
`DOCSYDE_HOST_ORIGIN=http://127.0.0.1:45873` in `.env` (one exact allowed local
origin; no cookies or browser credentials). Open an existing saved document, review
it, then Publish to `/requests/new`. Saving alone does not publish. An occupied
target requires explicit Replace; Unpublish removes only its association.

The Request Desk fixture lives in the separate `test-project` worktree. From this
DocSyde checkout, run `npm run sdk:build`, then copy the generated `.js` and `.d.ts`
files from `.artifacts/sdk/` into that fixture's `test-app/.artifacts/sdk/` directory.
This is ignored local build output, not a new dependency or committed SDK copy.
From the fixture checkout, run `npm --prefix test-app run build`,
`npm --prefix test-app test`, then `npm --prefix test-app start`.
The host defaults to repository `abishek1303/DocSyde` and delivery endpoint
`http://127.0.0.1:3000/api/documentation/context`; optional public local overrides
are `DOCSYDE_REPOSITORY_OWNER`, `DOCSYDE_REPOSITORY_NAME` and
`DOCSYDE_DELIVERY_ENDPOINT` when starting its server.

Open `http://127.0.0.1:45873/requests/new` and choose **Help for this page**.
Nonmatching routes show an empty state. Blocks display as escaped plain text;
qualifications remain visible. Refresh and reopening help retrieve persisted
publication state without AI/GitHub/signing credentials. Unpublish, then reopen
help or refresh to observe removal. This is a trusted-local demo boundary.

Run `npm run documentation:publications:test`, `npm run sdk:test` and existing
persistence/context/run checks. See the [publication guide](src/features/documentation/README.md#explicit-contextual-publication-local-demo)
for matching, replacement, delivery fields and limitations. A live proof requires
an already saved create-request document; never substitute fixture/unrelated content.

With both servers running and the target empty, run
`npm run documentation:publications:verify -- <existing-saved-document-id> [docsyde-origin]`.
The verifier requires saved create-request content, uses the actual publishing UI,
checks matching/nonmatching, refresh and navigation cancellation, then unpublishes.
It refuses an occupied target and does not seed or regenerate documents. Screenshots
are written under ignored `.artifacts/publication-proof/`.

## Model and runtime flow audit

October 30, 2026: documentation-only audit of the working tree, including existing
uncommitted vision/capture code. See [MODEL_USAGE.md](MODEL_USAGE.md) for code
references, intended flow, current boundaries and planned steps. No application
implementation was changed by this audit.

| Check | Actual result |
| --- | --- |
| `npm run ai:test` | 10 passed, 0 failed |
| `npm run ai:vision:test` | 18 passed, 0 failed; mocked Meta transport and screenshot contracts |
| `npm run sources:test` | 27 passed, 0 failed |
| `npm run documentation:test` | 16 passed, 0 failed |
| `npm run github:test` | 42 passed, 0 failed |
| `npm run git:test` | 4 passed, 0 failed |
| `npm run sdk:test` | 6 passed, 0 failed |
| `npm run storage:test` | 13 passed, 0 failed |
| `npm run runner:test` | 0 passed, 2 failed: environment denied listening on `127.0.0.1` (`EPERM`) |
| `npm run capture:test` | 1 passed, 10 failed (including parent/subtests): local fixture port binding denied (`EPERM`) |
| `npm run runner:capture:test` | 34 passed, 2 failed: real launch/attach cases blocked by local port binding (`EPERM`); mocked lifecycle cases passed |
| `npm run lint` | Passed |
| `npx next typegen` | Passed |
| `npx tsc --noEmit` | Passed |
| `npm run build -- --webpack` | Passed, including TypeScript and route generation |

No live hosted-model calls, database-backed suites, live SDK/browser verifier or
combined product demo were run. Model tests establish local parsing, validation
and transport behavior with mocks, not account/model availability or factual
quality. Runtime/browser suites must be rerun where local fixture servers can
listen before claiming a live capture pass. No visual UI changes were made.

## Proposal review proof

Run `npm run db:migrate` to apply migration **0006**, which adds the narrow retained
proposal/review table. Existing V1/V2 documents/publications are unchanged; no backfill.
Local PostgreSQL and the existing repository allowlist are required. Review/apply
requires no signing key or model credentials and makes zero inference calls.

Retain authority directly at the transformation producer (this initial command still
performs the usual transformation/support model work; do not run it merely to test review):

```sh
npm run documentation:transform:verify -- <trusted-impact.json> <validated-plan.json> --retain
npm run documentation:review -- show <proposal-uuid>
npm run documentation:review -- apply <selection.json>
npm run documentation:review -- receipts <proposal-uuid>
```

The producer reports proposal UUID/hash. Apply takes only selection/publication intent,
never a proposal/canonical blob. Use the [review contract](src/features/documentation/README.md#retained-proposal-review-immutable-save-and-optional-publication)
for selection JSON. To replace an authorized target, add
`{"targetId":"<descriptor UUID>","intent":"replace","observedPublicationId":"<observed UUID>"}`
to publications. To publish an authorized empty target use
`{"targetId":"<descriptor UUID>","intent":"publish"}`. Empty publications means save-only.
Do not share printed review/proposal source content publicly; these are local inspection
commands. The private transformation artifact remains unsigned and cannot be imported
as review authority.

First selection is frozen; identical retry resumes/replays, changed selection conflicts.
Expiry blocks first acceptance after 24 hours; accepted operations can resume. Save
and publication commit independently with receipts: a publication conflict can coexist
with a saved document. Inspect receipts after failure rather than changing observations
or assuming rollback. The old snapshot is never overwritten. No-change/unresolved
acknowledgment creates review metadata only, no document/publication writes.

`npm run documentation:review:verify` is the deterministic PostgreSQL proof with fixtures,
no inference, isolated rows and cleanup; it exercises subset rejection, V1/V2 saves,
replacement/contextual retrieval, save-only, publication conflicts, replay and rollback.
`npm run documentation:review:test` also runs admission/subset/dependency-boundary tests.
The proposal UI now submits explicit review choices through a Server Action. Editing/rebase and changing an accepted selection remain deferred.

## Schema-v2 slice verification

The full repository test invocation (all `src` and `infra/local` `.test.ts` files,
Node react-server condition, tsx, concurrency four) passed **519 tests**, including
PostgreSQL, real Chromium and mocked providers. The focused run proof additionally
guards approval/save/publication operations to throw if invoked. Lint,
`next typegen`, `tsc --noEmit`, webpack production build and diff checks passed.
A production `next start` browser proof returned 202 before source inference
finished, reached retained awaiting-review through five mocked model calls, and
passed desktop/mobile rendering with zero browser errors. No live inference ran.
Sandbox restrictions require local PostgreSQL/port/Chromium permission for these
integration checks; they passed with that access. Temporary servers were stopped.

## Planner section candidate selection

No migration, dependency or configuration is required. Planning first uses a derived
PostgreSQL section-search projection, then loads/validates at most ten selected
immutable documents. Existing operator associations supplied to runs provide exact
metadata signals; inferred canonical associations retain their finding provenance.
No classifications are automatically written to documents.

Selection returns typed selected document IDs, section IDs/hashes, deterministic
score explanations, coverage and fallback usage. Exact association matches score 40;
matching words score 2 in document titles, 3 in section titles and 1 in section text.
Text-only eligibility needs two distinct title words or three body words. Query
signals are capped at 24 distinct lowercase ASCII words and 20 exact associations.
Every eligible competitor within bounds remains available; overflow is incomplete.
If nothing useful matches, the previous broad-loading path and limits still apply.
A search subset is never reported as corpus-complete or proof of a documentation gap.
SDK retrieval/publication behavior and model-call counts are unchanged.

Focused checks (providers mocked; PostgreSQL required for the second command):

```sh
node --conditions=react-server --import tsx --test src/features/documentation/planning/candidate-selection.test.ts
node --conditions=react-server --import tsx --test infra/local/documentation/candidate-selection.test.ts
```

The proof includes a repository exceeding the former ten-document loading bound,
correct section targeting with complete target outlines, exact metadata/text parity,
historical snapshot ambiguity, safe fallback, v1/v2 inferred provenance and overflow
without inference. Existing planner tests explicitly exercise broad fallback.

Selector-slice verification: all **532 repository tests** passed with mocked
providers, PostgreSQL and existing Chromium fixtures. Focused checks also prove
selected snapshot-hash mismatch blocks transformation before generation. Lint,
route type generation, TypeScript and webpack production build passed. No live
model calls, migrations or browser UI changes were introduced.

## Application layout and run preparation

- `/`: a short introduction and **Start a run**. It renders without provider calls.
- `/runs`: repository run history, **Start a new run**, and **Rerun**.
- `/runs/new`: choose a branch, see its **Latest change**, optionally add **Context**,
  and select **Start run**. It defaults to the branch with the newest tip commit.
  Changing branches updates the commit headline without inference. Reruns retain
  the original comparison and context in a separate attempt.
- `/docs`: **Latest** renders the newest saved draft; **Pending** lists proposals
  awaiting approval; **Archive** contains previous published versions with read-only previews.
  Latest and archived readers include searchable document navigation, section links,
  a fixed breadcrumb and independent article scrolling, with compact mobile navigation.
  Proposal previews are at `/documentation/proposals/<proposal-id>`; schema-v2
  approval/save uses the proposal review form, with [CLI instructions above](#proposal-review-proof) available for operators.
- `/ai`: the implemented contextual retrieval endpoint/SDK and planned MCP support.

Repository/branch selection is preserved by primary navigation. Existing source
and commit tools remain accessible through secondary links and their original URLs.
Run preparation requires configured GitHub access; history and documentation require
PostgreSQL with migrations applied (`npm run db:migrate`). Migration 0007 adds
publication history for replacements and unpublishing from this point forward;
earlier retired publication links cannot be reconstructed. No new environment variables.

The demo action resolves the selected branch on submission and compares its latest
commit with its first parent. Comparison checks and commit pinning happen on the
server. Earlier-base controls remain in the technical source tools. Whole-project
initial analysis and automatic “since last handled run” baselines remain planned;
the first root commit cannot be analyzed by the comparison-only workflow.

`npm run documentation:library:test` checks repository authorization, canonical
identity validation, library projection and pinned comparison previews with mocked
transports. Live PostgreSQL and browser checks are separate integration checks.

### Runs: branch selection, navigation and failures

On `/runs/new`, the **Branch** field automatically selects the branch with the
newest tip commit (ties prefer the default branch). Its commit headline appears
below as **Latest change**. Override the branch directly in the form; no preview
button is needed. Automatic selection reads up to 1000 branches; if selection is
unavailable, enter a branch explicitly. This does not start analysis. Run history
includes all branches and has no branch switch; choose a branch only in run setup.
Breadcrumbs return to setup or the previous run page.

New failed runs show an allowlisted explanation, recovery suggestion and failure
code. Detailed provider errors and source bodies are never copied into this
public diagnostic. Older failures cannot recover a cause that was not retained;
start a new attempt to capture one. No database migration is required.

Focused checks: `npm run documentation:runs:unit:test`. The existing
`npm run documentation:runs:test` additionally requires PostgreSQL and Chromium.

### AI responses during a run

The run view shows a selectable pipeline beside a scrollable output panel on
desktop, stacked on mobile. The panel follows the active stage and shows only its
activity: AI thinking, runtime capture, a one-line code-step description, or the
completed AI result. It does not repeat pipeline labels or show previous-stage
output. Runtime capture has no live browser stream yet. The run page shows the change,
optional added context, pipeline and activity. Context over 140 characters is
shortened with an ellipsis and a **Read more / Read less** toggle. Cancel is a labelled button with a stop icon
beside the change. Technical metadata and secondary action links are omitted; a
completed update keeps its review/open action in the output panel. Select a stage to inspect it;
**Follow pipeline** resumes automatic tracking. Full validated responses load only
for the displayed stage, without rerunning a model. Stages without an AI call,
skipped stages and unavailable/rejected outputs have explicit labels.

Existing validated source/decision/impact/planning results can be viewed on older
runs. Runtime output requires the original artifact in `DOCSYDE_STORAGE_DIRECTORY`;
generated changes require the retained proposal. Missing output is not regenerated.
No new credentials or migrations are needed. `npm run documentation:runs:unit:test`
includes authorization, integrity, display bounds and no-inference response checks
using mocked database transport and temporary local artifacts.

The application header and navigation remain fixed while the page content scrolls.
The document reader keeps navigation and article scrolling separate. Keyboard focus,
section links and reduced-motion preferences work within the content viewport.

### UI motion

GSAP and `@gsap/react` are installed through `npm ci`; no extra configuration is
needed. The run timeline animates actual stage changes and reveals saved responses
and the retained-proposal link without replaying on status polls. Overview uses a
short entrance sequence; document content, branch summaries, form errors and loaded
response content use brief reveals. Motion respects the system reduced-motion
preference, including changes while the page is open. Animations clean up on
unmount; execution, inference and publication behavior are unchanged.

## Trusted runtime capabilities and UI review

The operator-managed run workflow may additionally declare `capabilities` and
`supportingSourcePaths`. Existing configurations remain valid with empty lists.
A capability selects the scope of the **existing single workflow**, not a new
browser script. Every declared capability route must be in `supportedPathnames`.
For Request Desk, add these fields to the complete runtime configuration:

```json
{
  "capabilities": [{
    "id": "urgent-request-result",
    "pathname": "/requests/new",
    "description": "Create an urgent request using the configured workflow and observe the displayed priority in the resulting request details. Does not visually verify initial form defaults, close/reopen, or refresh."
  }],
  "supportingSourcePaths": ["test-app/src/public/app.ts", "test-app/src/server.ts"],
  "maxSelectedScreenshots": 1
}
```

The example extends the existing launch/attach + workflow JSON; it is not a
standalone executable configuration. The model can select supplied capability IDs
but never commands, selectors or actions. Supporting source is read from the pinned
run head, at most three explicitly named files and 16 KiB combined whole content.
Missing, unsupported and oversized files are recorded explicitly. Capability metadata
and selection are not evidence that the product works. Captures establish only
observed runtime state; a current screenshot does not establish prior behavior.

Open a run's retained proposal or **Documentation → Pending**. Choose approve/reject
(or acknowledge/reject) for every decision; there are no default approvals. Inspect
previews and qualifications, then **Save reviewed changes**. Unready changes cannot
be approved. Saved-document receipts link to the immutable document and its separate
Publish/Replace controls. Accepted review choices are frozen; retry uses the identical
selection. Refresh/reopen and review/save/publication make no inference calls.

Failed runs retain bounded failure kind, model, completion reason, elapsed time,
returned token usage and known schema issue paths when available. **Failure details**
expands these safe fields. No raw rejected response is stored, and older failures
cannot recover details. There are no automatic retries or repair calls.

### Offline priority contract check

`node --conditions=react-server --import tsx --test infra/local/documentation/priority-contract.test.ts`
replays retained priority inputs with mocked provider outputs and a frozen Request Desk
snapshot through synthesis, planning, transformation, proposal rendering and save
materialization. It requires no credentials or database writes and makes no live
inference calls. This is deterministic contract verification, not final live verification.
Run-stage panels now show readable saved findings and evidence limitations, with the
technical response collapsed. Proposal previews are labelled as proposed content;
saved-document receipts remain the authority for save state.

## Sources module layout

Sources implementations and colocated tests are grouped by responsibility under
`src/features/sources`; see its [module map](src/features/sources/README.md#organization).
`npm run sources:test` discovers the grouped test files. Existing feature entry
modules, configuration and workflows are unchanged.

## Documentation module layout

Documentation implementations, UI and colocated tests are grouped by responsibility;
see the [module map](src/features/documentation/README.md#organization). Existing
verification scripts use the grouped paths. No configuration or workflow changes.

### AI invocation debug logs

Run `npm run db:migrate` to apply migration **0008**. Existing `DATABASE_URL` is the
only logging configuration. Text and vision calls retain best-effort metadata;
missing PostgreSQL/log writes do not fail model calls. Apply migration **0009** for
nullable approved payloads, fixed omission reasons and requested-configuration snapshots.
Open the **Logs** tab for the **AI model usage log** table. Select a row to view
all retained invocation metadata and sanitized diagnostics. The table has 25 rows per
page and status, provider, and exact-stage filters. Run pages link to their
filtered logs; model failures link to a detail page instead of showing diagnostics
inline. Historical failures without logs show saved failure details where available.
Standalone calls without a repository-bound run remain SQL-only. Intermediate rows
may reflect interrupted execution.

`npm run ai:test` covers lifecycle failure isolation and metadata sanitization.
`npm run ai:logging:verify` checks the migrated PostgreSQL table using temporary
fixture rows, cleans up those rows, and makes no model calls. No new credentials,
services, or retention workers are required. See [MODEL_USAGE.md](MODEL_USAGE.md).


### AI reliability baseline

`npm run ai:test` also tests typed option serialization, model capability gates, payload
allowlisting, size omission and validation failure isolation. `npm run sources:test`
and `npm run documentation:test` cover generation limits and historical compatibility.
`npm run ai:logging:verify` verifies the new columns with temporary local PostgreSQL
fixtures and no provider calls. Approved payloads are SQL-only; the Logs UI continues
to expose metadata and sanitized diagnostics. No new environment variables are required.

Existing reasoning/sampling behavior and output ceilings are unchanged. Do not use live
AI verification commands to tune them without separate authorization. See
[MODEL_USAGE.md](MODEL_USAGE.md#reliability-baseline-and-safe-payload-policy) for the
allowlist, current capacity risks and exact-alias reasoning restriction.

### Three-scenario reliability baseline

Run `npm run reliability:test` for offline budget/capability checks and
`npm run reliability -- scenarios` for the three pinned Request Desk patch fixtures,
app tests/build, deterministic Chromium checks and inference-free runner capture.
Artifacts remain under ignored `.artifacts/reliability`; the original test-project
worktree and publications are untouched. See the [reliability runbook](infra/local/reliability/README.md)
for independent commits/GitHub readability, frozen corpus and database copies,
single-batch admission, manifest sealing, explicit live-run authorization,
review/publication lineage, restoration and comparison reports. Set server-only
`DOCSYDE_RELIABILITY_MANIFEST` only for an isolated experiment server; ordinary
runs retain existing behavior. Offline checks are not live reliability results.
