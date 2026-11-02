CREATE TABLE "hypotheses" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"opened_turn_id" text,
	"closed_turn_id" text,
	"statement" text NOT NULL,
	"facts" jsonb NOT NULL,
	"check" text NOT NULL,
	"check_on" date NOT NULL,
	"status" text NOT NULL,
	"result" text,
	"result_facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "keywords" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "negative_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "device_adjustments" jsonb DEFAULT '{"mobile":0,"desktop":0}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "device_adjusted_on" jsonb DEFAULT '{"mobile":null,"desktop":null}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD CONSTRAINT "hypotheses_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hypotheses_business_time" ON "hypotheses" USING btree ("business_id","opened_at");