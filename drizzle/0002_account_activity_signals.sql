ALTER TABLE "accounts" ADD COLUMN "followers_count" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "follows_count" integer;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_active_checked_at" timestamp with time zone;