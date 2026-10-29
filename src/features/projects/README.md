# Projects

Implemented: a plain Project type and server-only `createProject` / `getProject` operations. Names are trimmed and validated as 1–200 characters; IDs must be UUIDs. Reads return `null` for missing projects. SQL and Drizzle details live in the database integration; operations return the application Project shape.

Run `npm run db:verify` for the local create/read proof. These operations currently serve only the trusted local CLI; there is no membership, authentication, public endpoint, or Project UI. Add resource authorization before exposing them to users.
