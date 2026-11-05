CREATE TABLE "ad_images" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"png" "bytea" NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"source" text NOT NULL,
	"seed" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ads" ADD COLUMN "image_id" text;--> statement-breakpoint
ALTER TABLE "ads" ADD COLUMN "image_hash" text;--> statement-breakpoint
ALTER TABLE "ad_images" ADD CONSTRAINT "ad_images_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_images_business" ON "ad_images" USING btree ("business_id","created_at");--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_image_id_ad_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."ad_images"("id") ON DELETE no action ON UPDATE no action;