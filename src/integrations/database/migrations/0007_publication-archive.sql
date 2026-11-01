CREATE TABLE "docsyde"."documentation_publication_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"repository" varchar(512) NOT NULL,
	"route" varchar(300) NOT NULL,
	"draft_id" uuid NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docsyde"."documentation_publication_history" ADD CONSTRAINT "documentation_publication_history_draft_id_documentation_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "docsyde"."documentation_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documentation_publication_history_repository_archived_idx" ON "docsyde"."documentation_publication_history" USING btree ("repository","archived_at","id");