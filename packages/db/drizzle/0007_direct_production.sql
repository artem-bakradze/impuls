CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_accounts" ALTER COLUMN "login" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "lead_goal_id" text;