ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "kind" text DEFAULT 'google' NOT NULL;--> statement-breakpoint
UPDATE "users" SET "kind" = 'test' WHERE "google_sub" LIKE 'test:%';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unless_demo" CHECK ("users"."kind" = 'demo' OR "users"."email" IS NOT NULL);
