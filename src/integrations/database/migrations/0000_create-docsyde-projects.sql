CREATE SCHEMA IF NOT EXISTS "docsyde";
--> statement-breakpoint
-- Preserve projects from the earlier, uncommitted public-schema proof.
-- Fresh databases create their application table directly in docsyde.
DO $$
BEGIN
  IF to_regclass('public.projects') IS NOT NULL THEN
    IF to_regclass('docsyde.projects') IS NOT NULL THEN
      RAISE EXCEPTION 'Both public.projects and docsyde.projects exist; resolve the conflict before migrating';
    END IF;
    ALTER TABLE "public"."projects" SET SCHEMA "docsyde";
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "docsyde"."projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_name_not_blank" CHECK (length(trim("docsyde"."projects"."name")) > 0)
);
