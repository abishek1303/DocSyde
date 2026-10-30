CREATE TABLE "docsyde"."documentation_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"repository" varchar(512) NOT NULL,
	"status" varchar(32) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "documentation_runs_repository_created_idx" ON "docsyde"."documentation_runs" USING btree ("repository","created_at","id");