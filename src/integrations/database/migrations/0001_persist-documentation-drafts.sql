CREATE TABLE "docsyde"."documentation_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document" jsonb NOT NULL,
	"saved_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documentation_drafts_canonical_envelope" CHECK ((
    jsonb_typeof("docsyde"."documentation_drafts"."document") = 'object'
    AND "docsyde"."documentation_drafts"."document"->>'id' = "docsyde"."documentation_drafts"."id"::text
    AND "docsyde"."documentation_drafts"."document"->'schemaVersion' = '1'::jsonb
    AND "docsyde"."documentation_drafts"."document"->>'status' = 'draft'
  ) IS TRUE)
);
--> statement-breakpoint
CREATE INDEX "documentation_drafts_saved_at_id_idx" ON "docsyde"."documentation_drafts" USING btree ("saved_at","id");