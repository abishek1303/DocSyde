import { sql } from "drizzle-orm";
import { check, index, jsonb, pgSchema, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

export const docsydeSchema = pgSchema("docsyde");

export const projects = docsydeSchema.table("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
    .$onUpdate(() => new Date()),
}, (table) => [
  check("projects_name_not_blank", sql`length(trim(${table.name})) > 0`),
]);

export const documentationDrafts = docsydeSchema.table("documentation_drafts", {
  id: uuid("id").primaryKey(),
  document: jsonb("document").$type<unknown>().notNull(),
  savedAt: timestamp("saved_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
}, table => [
  check("documentation_drafts_canonical_envelope", sql`(
    jsonb_typeof(${table.document}) = 'object'
    AND ${table.document}->>'id' = ${table.id}::text
    AND ${table.document}->'schemaVersion' = '1'::jsonb
    AND ${table.document}->>'status' = 'draft'
  ) IS TRUE`),
  index("documentation_drafts_saved_at_id_idx").on(table.savedAt, table.id),
]);

export const repositoryContexts = docsydeSchema.table("repository_contexts", {
  repository: varchar("repository", { length: 512 }).primaryKey(),
  text: varchar("text", { length: 500 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const documentationRuns = docsydeSchema.table("documentation_runs", {
  id: uuid("id").primaryKey(),
  repository: varchar("repository", { length: 512 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  payload: jsonb("payload").$type<unknown>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
}, table => [index("documentation_runs_repository_created_idx").on(table.repository, table.createdAt, table.id)]);

export const documentationPublications = docsydeSchema.table("documentation_publications", {
  id: uuid("id").primaryKey(),
  repository: varchar("repository", { length: 512 }).notNull(),
  route: varchar("route", { length: 300 }).notNull(),
  draftId: uuid("draft_id").notNull().references(() => documentationDrafts.id, { onDelete: "restrict" }),
  publishedAt: timestamp("published_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
}, table => [uniqueIndex("documentation_publications_repository_route_idx").on(table.repository, table.route)]);
