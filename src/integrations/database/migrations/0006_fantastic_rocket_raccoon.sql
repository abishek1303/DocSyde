CREATE TABLE "docsyde"."documentation_proposal_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"repository" varchar(512) NOT NULL,
	"proposal_hash" varchar(64) NOT NULL,
	"proposal" jsonb NOT NULL,
	"targets" jsonb NOT NULL,
	"registered_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"review" jsonb,
	CONSTRAINT "documentation_reviews_envelope" CHECK ((
    "docsyde"."documentation_proposal_reviews"."proposal_hash" ~ '^[a-f0-9]{64}$'
    AND "docsyde"."documentation_proposal_reviews"."repository" = lower("docsyde"."documentation_proposal_reviews"."repository")
    AND "docsyde"."documentation_proposal_reviews"."repository" ~ '^https://github.com/[^/]+/[^/]+$'
    AND "docsyde"."documentation_proposal_reviews"."expires_at" > "docsyde"."documentation_proposal_reviews"."registered_at"
    AND "docsyde"."documentation_proposal_reviews"."proposal"->>'proposalId' = "docsyde"."documentation_proposal_reviews"."id"::text
    AND jsonb_typeof("docsyde"."documentation_proposal_reviews"."proposal") = 'object'
    AND octet_length("docsyde"."documentation_proposal_reviews"."proposal"::text) <= 2097152
    AND jsonb_typeof("docsyde"."documentation_proposal_reviews"."targets") = 'array'
    AND jsonb_array_length("docsyde"."documentation_proposal_reviews"."targets") <= 64
    AND ("docsyde"."documentation_proposal_reviews"."review" IS NULL OR (jsonb_typeof("docsyde"."documentation_proposal_reviews"."review") = 'object'
      AND "docsyde"."documentation_proposal_reviews"."review"->>'operationId' IS NOT NULL
      AND octet_length("docsyde"."documentation_proposal_reviews"."review"::text) <= 262144))
  ) IS TRUE)
);
--> statement-breakpoint
CREATE INDEX "documentation_reviews_repository_idx" ON "docsyde"."documentation_proposal_reviews" USING btree ("repository","registered_at");