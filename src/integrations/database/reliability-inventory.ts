import "server-only";
import { sql } from "drizzle-orm";
import { getDatabase } from "./client";
import { schemaFingerprint, semanticSchema, type SchemaFacts } from "./schema-fingerprint";
import { z } from "zod";

/** One repeatable-read view; includes every saved document eligible for repository search. */
export async function readReliabilityInventory(repository: string) {
  return getDatabase().transaction(async database => {
    const identity = await database.execute(sql`SELECT current_database() AS name`);
    // Pin deparser visibility; names are resolved structurally, never by catalog OID.
    await database.execute(sql`SET LOCAL search_path = pg_catalog`);
    const tables = await database.execute(sql`SELECT n.nspname || '.' || c.relname AS "table", c.relkind AS kind
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='docsyde' AND c.relkind IN ('r','p')`);
    const columns = await database.execute(sql`SELECT n.nspname || '.' || c.relname AS "table", a.attname AS name, a.attnum AS position,
      tn.nspname || '.' || t.typname AS type, a.atttypmod AS modifier, a.attnotnull AS "notNull", a.attidentity AS identity,
      a.attgenerated AS generated, pg_get_expr(d.adbin,d.adrelid,false) AS "default"
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_type t ON t.oid=a.atttypid JOIN pg_namespace tn ON tn.oid=t.typnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      WHERE n.nspname='docsyde' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped`);
    const constraints = await database.execute(sql`SELECT n.nspname || '.' || c.relname AS "table", k.contype AS kind,
      ARRAY(SELECT a.attname FROM unnest(k.conkey) WITH ORDINALITY x(num,ord) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.num ORDER BY x.ord) AS columns,
      CASE WHEN k.confrelid=0 THEN NULL ELSE rn.nspname || '.' || rc.relname END AS target,
      ARRAY(SELECT a.attname FROM unnest(k.confkey) WITH ORDINALITY x(num,ord) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.num ORDER BY x.ord) AS "targetColumns",
      k.confupdtype AS "onUpdate", k.confdeltype AS "onDelete", k.confmatchtype AS match,
      k.condeferrable AS deferrable, k.condeferred AS deferred, k.convalidated AS validated,
      CASE WHEN k.contype='c' THEN pg_get_expr(k.conbin,k.conrelid,false) ELSE NULL END AS expression
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_class rc ON rc.oid=k.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace WHERE n.nspname='docsyde'`);
    const indexes = await database.execute(sql`SELECT n.nspname || '.' || c.relname AS "table", am.amname AS method,
      i.indisunique AS unique, i.indisprimary AS primary, i.indisvalid AS valid, i.indisready AS ready,
      i.indnullsnotdistinct AS "nullsNotDistinct", i.indnkeyatts AS "keyCount",
      ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY x(num,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=x.num ORDER BY x.ord) AS columns,
      i.indoption::smallint[] AS options,
      ARRAY(SELECT onsp.nspname || '.' || op.opcname FROM unnest(i.indclass) WITH ORDINALITY x(oid,ord) JOIN pg_opclass op ON op.oid=x.oid JOIN pg_namespace onsp ON onsp.oid=op.opcnamespace ORDER BY x.ord) AS "operatorClasses",
      ARRAY(SELECT CASE WHEN x.oid=0 THEN NULL ELSE cn.nspname || '.' || col.collname END FROM unnest(i.indcollation) WITH ORDINALITY x(oid,ord) LEFT JOIN pg_collation col ON col.oid=x.oid LEFT JOIN pg_namespace cn ON cn.oid=col.collnamespace ORDER BY x.ord) AS collations,
      pg_get_expr(i.indpred,i.indrelid,false) AS predicate, pg_get_expr(i.indexprs,i.indrelid,false) AS expressions
      FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_class ic ON ic.oid=i.indexrelid JOIN pg_am am ON am.oid=ic.relam WHERE n.nspname='docsyde'`);
    if (indexes.rows.some(row => row.expressions !== null)) throw new Error("Unsupported schema expression: expression index");
    const migrations = await database.execute(sql`SELECT hash FROM drizzle.__drizzle_migrations`);
    const facts = { tables: tables.rows, columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows, migrations: migrations.rows } as SchemaFacts;
    const fingerprint = schemaFingerprint(facts);
    const documents = await database.execute(sql`SELECT id, document FROM docsyde.documentation_drafts
      WHERE lower(document->'provenance'->>'repository') = ${repository.toLowerCase()} ORDER BY id`);
    const publications = await database.execute(sql`SELECT id, repository, route, draft_id AS "documentId", published_at AS "publishedAt"
      FROM docsyde.documentation_publications WHERE lower(repository) = ${repository.toLowerCase()} ORDER BY route`);
    const context = await database.execute(sql`SELECT repository, text FROM docsyde.repository_contexts WHERE lower(repository) = ${repository.toLowerCase()} ORDER BY repository`);
    return { schemaFingerprint: fingerprint, semanticSchema: semanticSchema(facts), databaseName: z.object({ name: z.string() }).parse(identity.rows[0]).name,
      documents: z.array(z.object({ id: z.uuid(), document: z.unknown() }).strict()).parse(documents.rows),
      publications: z.array(z.object({ id: z.uuid(), repository: z.string(), route: z.string(), documentId: z.uuid(), publishedAt: z.coerce.date().transform(value => value.toISOString()) }).strict()).parse(publications.rows),
      context: z.array(z.object({ repository: z.string(), text: z.string() }).strict()).parse(context.rows) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
