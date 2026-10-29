# Database integration

Implemented: lazy server-only `pg` pooling, Drizzle `docsyde` schema and schema-qualified Project queries, and committed SQL migrations. Connection configuration comes from `DATABASE_URL`. Feature operations own validation and application behavior; this integration owns SQL and ORM details.

Integrations do not import features or `app/`. Credentials and provider access stay on the server. No Supabase features are used.

Generate migrations with `npm run db:generate` and apply them with `npm run db:migrate`. Local Docker configuration and setup entry points live in `infra/local`; run `npm run db:setup` to start PostgreSQL, wait for health, and migrate. See the root README for verification.

Migration `0001_persist-documentation-drafts.sql` adds one complete canonical draft
per JSONB row with its existing UUID and millisecond-precision first save time.
Envelope constraints check matching IDs, v1 schema and draft status. The timestamp
precision makes cursor comparisons lossless through JavaScript Dates. A save-time/ID
index supports stable listing. Prior migrations and Projects rows are unchanged.

`documentation-drafts.ts` owns immutable insert/find/list queries. Insert conflicts
are compared using PostgreSQL JSONB equality; no UPDATE is issued. JSONB stays typed
`unknown` until documentation feature validation. No feature imports, repository
abstraction, Project relationship or caching are introduced. See the
[documentation guide](../../features/documentation/README.md#persistence-and-signed-saving)
for operations, validation, corrupt-row isolation and tests.
