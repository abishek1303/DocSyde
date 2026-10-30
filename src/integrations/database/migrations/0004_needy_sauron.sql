CREATE TABLE "docsyde"."documentation_publications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"repository" varchar(512) NOT NULL,
	"route" varchar(300) NOT NULL,
	"draft_id" uuid NOT NULL,
	"published_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docsyde"."documentation_publications" ADD CONSTRAINT "documentation_publications_draft_id_documentation_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "docsyde"."documentation_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documentation_publications_repository_route_idx" ON "docsyde"."documentation_publications" USING btree ("repository","route");