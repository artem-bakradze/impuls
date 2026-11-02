CREATE TABLE "simulations" (
	"business_id" text PRIMARY KEY NOT NULL,
	"scenario" text NOT NULL,
	"seed" bigint NOT NULL,
	"plan" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"sim_now" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"last_tick_at" timestamp with time zone,
	"speed" integer NOT NULL,
	"status" text NOT NULL,
	"state" jsonb NOT NULL,
	"baseline" jsonb
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "mode" text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "simulations" ADD CONSTRAINT "simulations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;