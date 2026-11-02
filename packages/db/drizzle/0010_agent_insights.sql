CREATE TABLE "insights" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"turn_id" text,
	"source" text NOT NULL,
	"reason_code" text NOT NULL,
	"observation" text NOT NULL,
	"facts" jsonb NOT NULL,
	"decision" jsonb NOT NULL,
	"next" text NOT NULL,
	"object_ref" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_turns" ADD COLUMN "summary_valid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_turns" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "agent_turns" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "agent_turns" ADD COLUMN "usage_source" text;--> statement-breakpoint
ALTER TABLE "agent_turns" ADD COLUMN "cost_kopecks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "change_log" ADD COLUMN "insight_id" text;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "insights_business_time" ON "insights" USING btree ("business_id","created_at");--> statement-breakpoint
-- The agent decides by default (add-agent-insights); per-business «off» switches stay as they were.
INSERT INTO "runtime_flags" ("name", "business_id", "enabled") VALUES ('agent_enabled', '*', true)
  ON CONFLICT ("name", "business_id") DO UPDATE SET "enabled" = true;--> statement-breakpoint
-- The launch of a simulation used to switch the agent off for its business; a simulation now always runs with it.
DELETE FROM "runtime_flags" WHERE "name" = 'agent_enabled' AND "business_id" IN (SELECT "id" FROM "businesses" WHERE "mode" = 'simulation');
