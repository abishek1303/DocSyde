CREATE TABLE "docsyde"."repository_contexts" (
	"repository" varchar(512) PRIMARY KEY NOT NULL,
	"text" varchar(500) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
