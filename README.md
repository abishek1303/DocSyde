# DocSyde

Contextual documentation, inside your product.

DocSyde will generate documentation from source code and product context, and surface relevant documentation and answers inside a host application. This repository currently contains a minimal Next.js homepage, shared UI primitives, and a modular monolith scaffold. A local PostgreSQL Project create/read proof is implemented; other capabilities remain planned.

## Local development

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
    github/               planned GitHub client and provider operations
    ai/                   planned model and embedding provider operations
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

See [AGENTS.md](AGENTS.md) for the full development rules. Authentication, provider connections, AI calls, ingestion, an embedded SDK, and background infrastructure are outside the current scaffold.
