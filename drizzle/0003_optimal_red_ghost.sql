CREATE TABLE "crawl_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"requested_by_did" text,
	"requested_at" timestamp with time zone DEFAULT now(),
	"claimed_at" timestamp with time zone
);
--> statement-breakpoint
DROP TABLE "account_signals" CASCADE;--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "followers_count";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "follows_count";