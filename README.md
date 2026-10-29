# DocSyde

Contextual documentation, inside your product.

DocSyde will generate documentation from source code and product context, and surface relevant documentation and answers inside a host application. This repository currently contains a minimal Next.js homepage, shared UI primitives, and a modular monolith scaffold. Independent persistence, source evidence, model invocation, runtime, SDK context, and browser capture proofs are implemented; the homepage connects GitHub evidence to AI change summaries; structured proposed drafts are implemented, while storage, publishing and delivery remain planned.

## Local development

See [SETUP.md](SETUP.md) for the working setup and testing notes. Keep that guide
updated as capabilities are connected; it is intentionally lightweight.

Use Node.js 20.9 or newer and npm with the checked-in lockfile.

```bash
npm ci
npm run dev
```

Open http://localhost:3000. No provider credentials or environment variables are required for the starter. The existing Geist fonts use `next/font/google`, which requires network access to Google Fonts during compilation.

## Local PostgreSQL persistence proof

Start Docker Desktop. For a new checkout:

```bash
cp .env.example .env
docker compose up -d
docker compose ps
npm run db:migrate
npm run db:verify
```

If `.env` exists, merge the PostgreSQL variables from `.env.example` instead of overwriting it. Wait for `docker compose ps` to show `healthy` before migrating, or use `docker compose up -d --wait`.

`COMPOSE_FILE` in `.env` points Docker Compose to `infra/local/compose.yaml`. PostgreSQL setup and verification entry points live under `infra/local/postgres/`. Run `npm run db:setup` to start PostgreSQL, wait for health, and apply migrations in one repeatable step; a future repository setup script can call the same entry point. See [local infrastructure](infra/local/README.md).

The app and CLI use `DATABASE_URL` from `.env`; Compose uses `POSTGRES_*`. Keep them in sync. If port 5432 is occupied, change both `POSTGRES_PORT` and the port in `DATABASE_URL`. Next.js can override `.env` through `.env.local`; keep any database override consistent with the CLI, which reads `.env`. Defaults are local development credentials; the port is published only on `127.0.0.1`. PostgreSQL initializes credentials only for a new volume; changing environment variables does not alter an existing database.

`db:verify` calls the Projects application operations through the persistence boundary. It checks invalid input and a missing project, saves a Project, and retrieves the same four fields through a fresh connection. Each normal run leaves one verification project in the local database. It prints a command to read that ID in another process:

```bash
npm run db:verify -- <printed-project-id>
docker compose restart postgres
# Wait for healthy, then read the same ID again.
npm run db:verify -- <printed-project-id>
```

The named `postgres_data` volume survives restarts and `docker compose down`. Stop normally with `docker compose down`. Adding `-v` deletes the volume and all local data.

The committed SQL migration creates only `docsyde.projects` (`id`, `name`, `createdAt`, `updatedAt`). `updatedAt` defaults on creation and is refreshed by Drizzle updates; no update operation is implemented yet. Fresh databases never create application tables in `public`. Existing projects from the earlier uncommitted proof are moved into `docsyde` with their data preserved. Drizzle records migration history separately in `drizzle`; `db:migrate` applies only unapplied migrations. After an intentional schema change, run `npm run db:generate -- --name=<description>`, review the SQL, then run `npm run db:migrate`.

The proof is CLI-only, with no public create/read API or Project UI. Authentication and resource authorization must be added before exposing these operations to users.

## GitHub source inspection proof

Set `GITHUB_TOKEN` in the ignored root `.env`. A fine-grained token with
**Contents: read** for selected repositories is recommended; any token with the
required GitHub access is supported. It is not needed to render or build the app.

```sh
npm run github:verify -- <owner> <repo> <base> <head> [--path <path>]
npm run github:test
```

The CLI resolves two refs to immutable commits, prints normalized commit/file
evidence, and optionally reads a text file at head. It rejects unsupported histories
and comparisons at GitHub's file-list cap rather than claiming incomplete evidence
is complete. Missing patches and unsupported file contents are explicit. This slice
does not clone repositories, run applications, call models, or write to GitHub.
See [GitHub integration](src/integrations/github/README.md) for a reproducible
example, credential setup, output semantics, and limits.

## Checks and production

```bash
npm run lint
npx next typegen
npx tsc --noEmit
npm run build
npm run start
```

`next typegen` generates the route types used by the layout before TypeScript checking. `npm run start` serves the production build; run it after a successful build.

## Architecture

One Next.js application, organized by product feature. Folders follow this ownership map:

```text
src/
  app/                    routes, layouts, handlers, actions, screen composition
  features/
    projects/             project setup, membership, settings
    sources/              connected sources, synchronization, ingestion
    documentation/        documents, generation, revisions, publishing
    assistant/            retrieval, answer generation, citations
    embed/                documentation and assistant UI inside host apps
  integrations/
    github/               read-only GitHub comparison and pinned file reader
    ai/                   typed text model invocation through Baseten
    database/             PostgreSQL client, schema, queries, and migrations
  components/ui/          existing shared UI primitives
  lib/                    small shared helpers, including utils.ts
```

## Module boundaries

- Keep `app/` focused on routing, request/response handling, framework caching, and screen composition. Product behavior belongs in features.
- Colocate each feature's UI, operations, schemas, types, and queries. Feature server operations own business rules, resource authorization, and feature-specific data access.
- Integrations own SDK setup and provider-specific operations; they must not import features or `app/`. Shared UI and generic helpers must not depend on features.
- Access another feature through a narrow, explicit entry module when needed. Avoid imports into another feature's internal components or queries, keep dependencies acyclic, and place orchestration in the feature that owns the workflow.
- Keep request objects, HTTP responses, redirects, and UI state out of reusable business operations. Return results for routes or actions to translate.
- Keep types and validation schemas with their owners; share contracts only when multiple modules use them. Avoid generic repositories, global service layers, broad barrel exports, and speculative abstractions.
- Default to Server Components, with client boundaries limited to interactive UI. Keep credentials, database access, ingestion, and model calls on the server; mark sensitive modules with `import "server-only"`. Deliberate Server Action entries must validate and authorize every invocation.
- Fetch server-rendered data through feature server functions. Use HTTP endpoints only for real HTTP boundaries, and validate untrusted input and enforce resource permissions in server operations.
- Preserve shared UI, theme tokens, and `src/lib/utils.ts`. Add implementation files only for concrete requirements.

See [AGENTS.md](AGENTS.md) for the full development rules. Model invocation and the host-context SDK are implemented as independent capability proofs. User authentication, provider installation flows, embeddings, ingestion, documentation delivery and embed UI, and background infrastructure remain future work. The GitHub-to-AI summary workflow is implemented; broader structured proposed drafts are implemented, while storage, publishing and delivery remain planned.

## Independent capability proofs

The following slices are implemented without connecting them into a product
workflow. No documentation generation, new persistence, UI, or orchestration is
included.

| Slice | Independent checks | Guide |
| --- | --- | --- |
| Text-only Baseten model | `npm run ai:test`, `npm run ai:verify` | [AI](src/integrations/ai/README.md) |
| Local committed Git evidence | `npm run git:test`, `npm run git:verify -- . HEAD~1 HEAD` | [Local Git](src/integrations/local-git/README.md) |
| Local launch/attach | `npm run runner:test`, `npm run runner:verify -- infra/local/runner/example.json` | [Runtime](src/runner/runtime/README.md) |
| Thin host context SDK | `npm run sdk:test`, `npm run sdk:verify` | [SDK](src/sdk/README.md) |
| Scripted browser evidence | `npm run capture:test`, `npm run capture:verify -- infra/local/capture/example.json` | [Capture](src/integrations/browser/README.md) |

Model live verification needs `BASETEN_API_KEY`; the event model defaults to
`meta-models/muse-spark-open-1026`. Browser proofs need `npx playwright install
chromium`. No new npm dependencies are required. Screenshots and compiled SDK
output stay under ignored `.artifacts/`. Source evidence, runtime evidence, and
model invocation remain separate; DOM extraction is not visual understanding.

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
block-to-finding-to-citation provenance. Nothing is saved or published.
Run `npm run documentation:test` or the credit-using `npm run documentation:verify`.
See the [Documentation guide](src/features/documentation/README.md) for the v1
model, limits, grounding checks, renderer restrictions and deferred work.
