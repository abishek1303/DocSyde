ALTER TABLE "docsyde"."ai_model_invocations" ADD COLUMN "request_payload" jsonb;--> statement-breakpoint
ALTER TABLE "docsyde"."ai_model_invocations" ADD COLUMN "response_payload" jsonb;--> statement-breakpoint
ALTER TABLE "docsyde"."ai_model_invocations" ADD COLUMN "request_omission_reason" varchar(40);--> statement-breakpoint
ALTER TABLE "docsyde"."ai_model_invocations" ADD COLUMN "response_omission_reason" varchar(40);--> statement-breakpoint
ALTER TABLE "docsyde"."ai_model_invocations" ADD COLUMN "inference_config" jsonb;