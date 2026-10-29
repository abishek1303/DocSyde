# Database integration

Implemented: lazy server-only `pg` pooling, Drizzle `docsyde` schema and schema-qualified Project queries, and committed SQL migrations. Connection configuration comes from `DATABASE_URL`. Feature operations own validation and application behavior; this integration owns SQL and ORM details.

Integrations do not import features or `app/`. Credentials and provider access stay on the server. No Supabase features are used.

Generate migrations with `npm run db:generate` and apply them with `npm run db:migrate`. Local Docker configuration and setup entry points live in `infra/local`; run `npm run db:setup` to start PostgreSQL, wait for health, and migrate. See the root README for verification.
