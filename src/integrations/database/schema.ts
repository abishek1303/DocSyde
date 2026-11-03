import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgSchema, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

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
    AND ${table.document}->'schemaVersion' IN ('1'::jsonb, '2'::jsonb)
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


// Retired publication associations retain immutable document references. Active
// publication identity remains in documentation_publications for existing CAS.
export const documentationPublicationHistory = docsydeSchema.table("documentation_publication_history", {
  id: uuid("id").primaryKey(),
  repository: varchar("repository", { length: 512 }).notNull(),
  route: varchar("route", { length: 300 }).notNull(),
  draftId: uuid("draft_id").notNull().references(() => documentationDrafts.id, { onDelete: "restrict" }),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [index("documentation_publication_history_repository_archived_idx").on(table.repository, table.archivedAt, table.id)]);


export const documentationReviews = docsydeSchema.table("documentation_proposal_reviews", {
  id: uuid("id").primaryKey(),
  repository: varchar("repository", { length: 512 }).notNull(),
  proposalHash: varchar("proposal_hash", { length: 64 }).notNull(),
  proposal: jsonb("proposal").$type<unknown>().notNull(),
  targets: jsonb("targets").$type<unknown>().notNull(),
  registeredAt: timestamp("registered_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, precision: 3 }).notNull(),
  review: jsonb("review").$type<unknown>(),
}, table => [
  index("documentation_reviews_repository_idx").on(table.repository, table.registeredAt),
  check("documentation_reviews_envelope", sql`(
    ${table.proposalHash} ~ '^[a-f0-9]{64}$'
    AND ${table.repository} = lower(${table.repository})
    AND ${table.repository} ~ '^https://github.com/[^/]+/[^/]+$'
    AND ${table.expiresAt} > ${table.registeredAt}
    AND ${table.proposal}->>'proposalId' = ${table.id}::text
    AND jsonb_typeof(${table.proposal}) = 'object'
    AND octet_length(${table.proposal}::text) <= 2097152
    AND jsonb_typeof(${table.targets}) = 'array'
    AND jsonb_array_length(${table.targets}) <= 64
    AND (${table.review} IS NULL OR (jsonb_typeof(${table.review}) = 'object'
      AND ${table.review}->>'operationId' IS NOT NULL
      AND octet_length(${table.review}::text) <= 262144))
  ) IS TRUE`),
]);

// Debug artifacts only: never evidence, authorization, or model input.
export const aiModelInvocations = docsydeSchema.table("ai_model_invocations", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").references(() => documentationRuns.id, { onDelete: "cascade" }),
  stage: varchar("stage", { length: 100 }).notNull(),
  operation: varchar("operation", { length: 100 }).notNull(),
  provider: varchar("provider", { length: 32 }).notNull(),
  model: varchar("model", { length: 300 }),
  status: varchar("status", { length: 32 }).notNull(),
  failureKind: varchar("failure_kind", { length: 100 }),
  completionReason: varchar("completion_reason", { length: 32 }),
  inputTokens: bigint("input_tokens", { mode: "number" }),
  outputTokens: bigint("output_tokens", { mode: "number" }),
  elapsedMs: bigint("elapsed_ms", { mode: "number" }),
  diagnostic: jsonb("diagnostic").$type<unknown>(),
  requestPayload: jsonb("request_payload").$type<unknown>(),
  responsePayload: jsonb("response_payload").$type<unknown>(),
  requestOmissionReason: varchar("request_omission_reason", { length: 40 }),
  responseOmissionReason: varchar("response_omission_reason", { length: 40 }),
  inferenceConfig: jsonb("inference_config").$type<unknown>(),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull(),
}, table => [
  index("ai_model_invocations_run_created_idx").on(table.runId, table.createdAt, table.id),
  check("ai_model_invocations_status", sql`${table.status} IN ('started', 'structured-success', 'succeeded', 'failed')`),
  check("ai_model_invocations_nonnegative", sql`(${table.inputTokens} IS NULL OR ${table.inputTokens} >= 0) AND (${table.outputTokens} IS NULL OR ${table.outputTokens} >= 0) AND (${table.elapsedMs} IS NULL OR ${table.elapsedMs} >= 0)`),
]);

export const documentationRunInspections = docsydeSchema.table("documentation_run_inspections", {
  runId: uuid("run_id").primaryKey().references(() => documentationRuns.id, { onDelete: "cascade" }),
  revision: bigint("revision", { mode: "number" }).notNull(),
  payload: jsonb("payload").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [check("documentation_run_inspections_bound", sql`(${table.revision} >= 0 AND ${table.payload}->>'version' = '1' AND octet_length(${table.payload}::text) <= 262144) IS TRUE`)]);

export const repositoryUnderstandings = docsydeSchema.table("repository_understandings", {
 repository: varchar("repository", { length: 512 }).primaryKey(), payload: jsonb("payload").$type<unknown>().notNull(),
});
