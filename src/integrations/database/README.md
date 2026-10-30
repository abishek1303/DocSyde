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
