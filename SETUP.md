# Working setup notes

Living document: update this as we build. Last updated October 29, 2026.
For architectural decisions, use [ARCHITECTURE.md](ARCHITECTURE.md).

## What runs where

- Your machine runs the Next.js app, local Git operations, the runner, and Playwright.
- Docker Compose runs PostgreSQL only. It does not start Next.js or the runner.
- GitHub supplies remote source evidence; Baseten hosts the model.
- The application being documented runs locally for browser capture. The SDK can
  register explicit route/feature context inside that application.

These capabilities are implemented independently. The homepage now connects GitHub comparison evidence to structured AI summaries.
Structured documentation drafts can be generated, previewed, explicitly saved to
PostgreSQL, and reopened without model calls. Publishing and contextual delivery remain unimplemented.

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

Baseten billing (read-only; no inference call): `npm run ai:billing` prints
organization-wide month-to-date gross cost, credits applied, and cost after credits
in USD using `BASETEN_API_KEY`. The server-only API is `getBasetenBilling` in
`src/integrations/ai/baseten/billing.ts`; no public HTTP endpoint is exposed.
Optional start/end ISO timestamps select a range of at most 31 days, starting no
earlier than January 1, 2026. Null categories mean unavailable usage, not a confirmed
zero. Remaining credits are explicitly unavailable: the public API reports credits
used, not the account balance; check the workspace Billing page for that balance.
Usage may lag and is not a finalized invoice. Provider reference:
[Baseten Management API specification](https://api.baseten.co/v1/spec).
Run `npm run ai:billing:test` for mocked validation and failure checks.
An optional third argument supplies starting credits for a clearly labeled estimate:
`npm run ai:billing -- 2026-10-01T00:00:00Z 2026-10-30T00:00:00Z 100`.
The estimate subtracts gross usage in the range from the grant; choose dates that
cover all grant usage. It cannot account for expired credits or unreported charges.
If Baseten returns HTTP 403, the configured key is denied billing access. Use a
key with access to the organization's Management API billing data, then rerun.

Other independent checks:

| Command | What it checks |
| --- | --- |
| `npm run git:verify -- . HEAD~1 HEAD --path README.md` | Local committed changes and a pinned file read; requires at least two commits |
| `npm run runner:verify -- infra/local/runner/example.json` | Starts a small fixture, waits for readiness, prints its description, then stops it |
| `npm run sdk:verify` | Builds the browser SDK and checks context registration/cleanup in Chromium |
| `npm run capture:test` | Captures a temporary test app; no separately started host app needed |
| `npm run capture:verify -- infra/local/capture/example.json` | Captures the app at localhost:3000; start it separately first |
| `npm run db:verify` | Creates and reads a verification project; leaves one record in PostgreSQL |

Automated suites: `npm run github:test`, `npm run ai:test`, `npm run git:test`,
`npm run runner:test`, `npm run sdk:test`, and `npm run capture:test`.
Only `ai:verify` calls the hosted model; `ai:test` uses mocked responses.
See the [integration guides](README.md#independent-capability-proofs) for limits.

## Current rough edges

- Runner cleanup owns only the direct child. Use an explicit executable; wrappers
  that start descendants need care. See the [runtime guide](src/runner/runtime/README.md).
- Screenshots, capture manifests, and compiled SDK output go under ignored `.artifacts/`.
- Browser checks require permission to launch Chromium and bind local ports.
- Turbopack builds have encountered port-binding restrictions in the agent environment.
  A webpack build has passed; `npm run build -- --webpack` is the fallback to try.
- Full-product testing comes after connecting the integrations. Targeting existing
  documentation, automatic updates, publishing, and delivery remain to be implemented.

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
`/changes` shows the latest 20 GitHub commits. Source analysis remains at `/sources`
with the existing context, semantic analysis, and draft-generation tools linked there.
Use `?repository=owner/name&branch=branch-name` to select an allowed repository and
GitHub branch. Omitting the branch resolves GitHub's default branch; this does not
represent the local checkout. A branch picker and commit analysis are deferred.
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
