CREATE TABLE "docsyde"."documentation_run_inspections" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"revision" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documentation_run_inspections_bound" CHECK (("docsyde"."documentation_run_inspections"."revision" >= 0 AND "docsyde"."documentation_run_inspections"."payload"->>'version' = '1' AND octet_length("docsyde"."documentation_run_inspections"."payload"::text) <= 262144) IS TRUE)
);
--> statement-breakpoint
ALTER TABLE "docsyde"."documentation_run_inspections" ADD CONSTRAINT "documentation_run_inspections_run_id_documentation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "docsyde"."documentation_runs"("id") ON DELETE cascade ON UPDATE no action;