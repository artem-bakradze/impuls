CREATE TABLE "approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"command" jsonb NOT NULL,
	"object_id" text NOT NULL,
	"reason_code" text NOT NULL,
	"explanation" text NOT NULL,
	"turn_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ads" ADD COLUMN "moderation" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;