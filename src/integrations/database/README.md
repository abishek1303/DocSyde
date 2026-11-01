# Database integration

Implemented: lazy server-only `pg` pooling, Drizzle `docsyde` schema and schema-qualified Project queries, and committed SQL migrations. Connection configuration comes from `DATABASE_URL`. Feature operations own validation and application behavior; this integration owns SQL and ORM details.

Integrations do not import features or `app/`. Credentials and provider access stay on the server. No Supabase features are used.

Generate migrations with `npm run db:generate` and apply them with `npm run db:migrate`. Local Docker configuration and setup entry points live in `infra/local`; run `npm run db:setup` to start PostgreSQL, wait for health, and migrate. See the root README for verification.

Migration `0001_persist-documentation-drafts.sql` adds one complete canonical draft
per JSONB row with its existing UUID and millisecond-precision first save time.
Envelope constraints check matching IDs, supported schema and draft status. The timestamp
precision makes cursor comparisons lossless through JavaScript Dates. A save-time/ID
index supports stable listing. Prior migrations and Projects rows are unchanged.

Migration `0005_nice_meggan.sql` widens only the existing envelope constraint from
schemaVersion 1 to versions 1/2. V2 can retain multiple source comparisons while
recording immutable revision provenance. No table, history system, backfill or saved
row rewrite is introduced. Existing immutable insert/JSONB-equality behavior is
unchanged. Run `npm run db:migrate`, then
`npm run documentation:transform:persistence:test` for isolated v1/v2 compatibility.

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

## Reliability schema fingerprint v2

`readReliabilityInventory` reads one read-only repeatable-read transaction. V1
hashed `information_schema.columns` (name, data_type, nullable, raw default), ordered
by table/ordinal, and `pg_constraint` names/raw `pg_get_constraintdef`, ordered by
constraint name. `baselineInventory` hashed those arrays with sorted object keys;
clone and scenario admission compared the digest. That omitted typmods, constraint
owners, standalone indexes and applied migration hashes.

V2 uses `pg_class`/`pg_namespace` for table identity/kind;
`pg_attribute`/`pg_type`/`pg_attrdef` for ordered column identity, resolved type,
`atttypmod`, nullability, identity/generated flags and defaults; `pg_constraint` for
owning table, ordered source/target columns, FK actions/match, validation and
constraint timing; and `pg_index`/`pg_am`/`pg_opclass`/`pg_collation` for standalone
and backing indexes, ordered keys/includes, uniqueness, NULL behavior, options,
operator classes, collations and validity. Applied `drizzle.__drizzle_migrations`
hashes are included as a multiset (including duplicate history entries), without
instance IDs or timestamps. Object names and OIDs are not semantic identity.

CHECKs use `pg_get_expr` only as parser input. The bounded grammar covers the
current catalog forms: qualified columns, typed string/numeric literals, casts,
arrays/ANY, JSON extraction, comparisons/regex, ordered AND/OR, NULL/boolean tests,
and the current built-in functions. `TRIM(BOTH FROM x)` is represented as `btrim(x)`.
Unknown functions/syntax, expression indexes and unsupported casts fail explicitly.

The observed source form was `ANY ((ARRAY['started'::character varying,
...])::text[])`; restore produced `ANY (ARRAY[('started'::character varying)::text,
...])`. Only text coercion of **unbounded varchar string literals**, individually
or as a complete literal array, is canonicalized to text-literal casts. Column
casts, other target types, value ordering and NULL envelopes remain significant.
No global cast stripping, arbitrary expression sorting or SQL regex rewriting is
used. Collections are sorted by canonical JSON with code-point ordering; key,
index and expression operand order is preserved. The hashed payload contains
`version: 2`; manifests also require `schemaFingerprintVersion: 2`.

The query deliberately does not model ACLs, roles, triggers, policies or extensions.
No current DocSyde migration requires those for this schema contract. Corpus,
publication and repository-context inventories remain unchanged.
