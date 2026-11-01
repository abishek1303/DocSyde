CREATE TABLE "docsyde"."ai_model_invocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid,
	"stage" varchar(100) NOT NULL,
	"operation" varchar(100) NOT NULL,
	"provider" varchar(32) NOT NULL,
	"model" varchar(300),
	"status" varchar(32) NOT NULL,
	"failure_kind" varchar(100),
	"completion_reason" varchar(32),
	"input_tokens" bigint,
	"output_tokens" bigint,
	"elapsed_ms" bigint,
	"diagnostic" jsonb,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "ai_model_invocations_status" CHECK ("docsyde"."ai_model_invocations"."status" IN ('started', 'structured-success', 'succeeded', 'failed')),
	CONSTRAINT "ai_model_invocations_nonnegative" CHECK (("docsyde"."ai_model_invocations"."input_tokens" IS NULL OR "docsyde"."ai_model_invocations"."input_tokens" >= 0) AND ("docsyde"."ai_model_invocations"."output_tokens" IS NULL OR "docsyde"."ai_model_invocations"."output_tokens" >= 0) AND ("docsyde"."ai_model_invocations"."elapsed_ms" IS NULL OR "docsyde"."ai_model_invocations"."elapsed_ms" >= 0))
);
--> statement-breakpoint
ALTER TABLE "docsyde"."ai_model_invocations" ADD CONSTRAINT "ai_model_invocations_run_id_documentation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "docsyde"."documentation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_model_invocations_run_created_idx" ON "docsyde"."ai_model_invocations" USING btree ("run_id","created_at","id");