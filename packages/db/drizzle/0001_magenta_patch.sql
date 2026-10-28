ALTER TABLE "campaigns" ADD COLUMN "schedule" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "geo_radius_km" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "change_log" ADD COLUMN "outcome" text;