import "server-only";
import { sql } from "drizzle-orm";
import { getDatabase } from "./client";
import { z } from "zod";

/** One repeatable-read view; includes every saved document eligible for repository search. */
export async function readReliabilityInventory(repository: string) {
  return getDatabase().transaction(async database => {
    const identity = await database.execute(sql`SELECT current_database() AS name`);
    const schema = await database.execute(sql`SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema = 'docsyde' ORDER BY table_name, ordinal_position`);
    const constraints = await database.execute(sql`SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'docsyde' ORDER BY c.conname`);
    const documents = await database.execute(sql`SELECT id, document FROM docsyde.documentation_drafts
      WHERE lower(document->'provenance'->>'repository') = ${repository.toLowerCase()} ORDER BY id`);
    const publications = await database.execute(sql`SELECT id, repository, route, draft_id AS "documentId", published_at AS "publishedAt"
      FROM docsyde.documentation_publications WHERE lower(repository) = ${repository.toLowerCase()} ORDER BY route`);
    const context = await database.execute(sql`SELECT repository, text FROM docsyde.repository_contexts WHERE lower(repository) = ${repository.toLowerCase()} ORDER BY repository`);
    return { schema: schema.rows, constraints: constraints.rows, databaseName: z.object({ name: z.string() }).parse(identity.rows[0]).name,
      documents: z.array(z.object({ id: z.uuid(), document: z.unknown() }).strict()).parse(documents.rows),
      publications: z.array(z.object({ id: z.uuid(), repository: z.string(), route: z.string(), documentId: z.uuid(), publishedAt: z.coerce.date().transform(value => value.toISOString()) }).strict()).parse(publications.rows),
      context: z.array(z.object({ repository: z.string(), text: z.string() }).strict()).parse(context.rows) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
