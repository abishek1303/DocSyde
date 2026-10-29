# Local infrastructure

`compose.yaml` defines Docker Desktop services. PostgreSQL setup, Drizzle CLI
configuration, and the persistence verification entry point live in `postgres/`.
Application persistence implementation and versioned migrations remain in
`src/integrations/database`.

From the repository root, merge `.env.example` into `.env`, then run:

```sh
npm run db:setup
npm run db:verify
```

`db:setup` starts PostgreSQL, waits for its health check, then applies migrations.
It is safe to rerun and does not create verification records. A future repository
setup script can invoke `sh infra/local/postgres/setup.sh`; the script resolves
the repository path independently of the caller's working directory. It never
overwrites `.env` or removes volumes.

`COMPOSE_FILE=infra/local/compose.yaml` in the root `.env` preserves the short
`docker compose up -d` command. The explicit Compose project name `docsyde`
preserves the existing `docsyde_postgres_data` volume when relocating the file.
The setup script uses explicit paths and does not depend on Compose discovery.

The additive documentation-draft migration uses this same PostgreSQL service and
volume. `npm run documentation:persistence:test` creates/cleans only isolated test
rows; `npm run documentation:persistence:verify` leaves a labeled draft for the local
list/detail UI. These checks make no model/source calls. See the
[documentation guide](../../src/features/documentation/README.md#persistence-and-signed-saving).

All application tables are schema-qualified under `docsyde`, independently of
the connection's `search_path`. The initial migration creates that schema before
creating `docsyde.projects`. For a database from the earlier uncommitted proof,
it moves `public.projects` into `docsyde` without losing rows. Drizzle migration
history stays in the separate `drizzle` schema.

GitHub source verification lives in `github/verify-source.ts` and runs through
`npm run github:verify -- <owner> <repo> <base> <head> [--path <path>]`. It reads
`GITHUB_TOKEN` from the root `.env` or process environment, uses only read-only
GitHub requests, and does not depend on Docker or PostgreSQL. See the
[GitHub integration guide](../../src/integrations/github/README.md).
