CREATE TABLE "account_signals" (
	"subject_did" text PRIMARY KEY NOT NULL,
	"followed_by_verified" boolean DEFAULT false NOT NULL,
	"verified_followers" jsonb DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE TABLE "account_verifications" (
	"subject_did" text NOT NULL,
	"verifier_did" text NOT NULL,
	"record_uri" text NOT NULL,
	"created_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"did" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"display_name" text,
	"description" text,
	"avatar" text,
	"is_custom_domain" boolean DEFAULT false NOT NULL,
	"seed_source" text,
	"indexed_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "backlog_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"subject_did" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"added_by_did" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crawl_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"finished_at" timestamp with time zone,
	"stats" jsonb
);
--> statement-breakpoint
CREATE TABLE "crawl_seeds" (
	"id" serial PRIMARY KEY NOT NULL,
	"keyword" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "crawl_seeds_keyword_unique" UNIQUE("keyword")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"member_did" text NOT NULL,
	"handle" text,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invited_by_did" text,
	"added_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "oauth_session" (
	"did" text PRIMARY KEY NOT NULL,
	"payload" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "oauth_state" (
	"key" text PRIMARY KEY NOT NULL,
	"payload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" serial PRIMARY KEY NOT NULL,
	"did" text NOT NULL,
	"handle" text NOT NULL,
	"scopes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"onboarded_by_did" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "orgs_did_unique" UNIQUE("did")
);
--> statement-breakpoint
CREATE TABLE "trusted_verifier_allowlist" (
	"did" text PRIMARY KEY NOT NULL,
	"handle" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"added_by" text,
	"added_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trusted_verifiers" (
	"did" text PRIMARY KEY NOT NULL,
	"handle" text,
	"source_list_uri" text
);
--> statement-breakpoint
CREATE TABLE "verification_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"actor_did" text NOT NULL,
	"action" text NOT NULL,
	"subject_did" text NOT NULL,
	"record_uri" text,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "av_uniq" ON "account_verifications" USING btree ("subject_did","verifier_did");--> statement-breakpoint
CREATE INDEX "accounts_handle_idx" ON "accounts" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "backlog_uniq" ON "backlog_items" USING btree ("org_id","subject_did");--> statement-breakpoint
CREATE UNIQUE INDEX "members_uniq" ON "members" USING btree ("org_id","member_did");