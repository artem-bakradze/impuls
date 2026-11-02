DROP TABLE "agent_notes" CASCADE;--> statement-breakpoint
DROP TABLE "approval_requests" CASCADE;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "city" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" DROP COLUMN "autonomy";--> statement-breakpoint
ALTER TABLE "businesses" DROP COLUMN "weekly_summary_enabled";--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN "geo_radius_km";--> statement-breakpoint
-- The agent is optional and off by default (simplify-mvp-scope decision 1); the ops CLI turns it on globally.
INSERT INTO "runtime_flags" ("name", "business_id", "enabled") VALUES ('agent_enabled', '*', false)
  ON CONFLICT ("name", "business_id") DO NOTHING;--> statement-breakpoint
-- «Подключите Яндекс Директ» and «Запуск» are one step now (simplify-mvp-scope decision 8).
UPDATE "businesses" SET "onboarding_step" = 6 WHERE "onboarding_step" > 6;
