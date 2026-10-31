ALTER TABLE "docsyde"."documentation_drafts" DROP CONSTRAINT "documentation_drafts_canonical_envelope";--> statement-breakpoint
ALTER TABLE "docsyde"."documentation_drafts" ADD CONSTRAINT "documentation_drafts_canonical_envelope" CHECK ((
    jsonb_typeof("docsyde"."documentation_drafts"."document") = 'object'
    AND "docsyde"."documentation_drafts"."document"->>'id' = "docsyde"."documentation_drafts"."id"::text
    AND "docsyde"."documentation_drafts"."document"->'schemaVersion' IN ('1'::jsonb, '2'::jsonb)
    AND "docsyde"."documentation_drafts"."document"->>'status' = 'draft'
  ) IS TRUE);