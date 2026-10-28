CREATE TYPE "public"."actor" AS ENUM('agent', 'safety_net', 'budget_guard', 'user', 'reconciliation');--> statement-breakpoint
CREATE TYPE "public"."change_author" AS ENUM('service', 'user', 'cabinet');--> statement-breakpoint
CREATE TYPE "public"."change_status" AS ENUM('pending', 'applied', 'failed');--> statement-breakpoint
CREATE TYPE "public"."object_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TABLE "ads" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"platform_ad_id" text NOT NULL,
	"status" "object_status" NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"created_on" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"event" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_by_turn_id" text
);
--> statement-breakpoint
CREATE TABLE "agent_notes" (
	"business_id" text PRIMARY KEY NOT NULL,
	"notes" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"trigger" text NOT NULL,
	"runtime" text NOT NULL,
	"instructions_version" text NOT NULL,
	"status" text NOT NULL,
	"context" jsonb NOT NULL,
	"calls" jsonb NOT NULL,
	"summary" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"time_zone" text NOT NULL,
	"monthly_budget_rub" integer NOT NULL,
	"launched_on" date,
	"cso_mode" text NOT NULL,
	"cso_value" bigint NOT NULL,
	"autonomy" text DEFAULT 'auto' NOT NULL,
	"card" jsonb NOT NULL,
	"onboarding_step" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"platform_campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"status" "object_status" NOT NULL,
	"weekly_limit" bigint NOT NULL,
	"strategy_id" text NOT NULL,
	"created_on" date NOT NULL,
	"last_limit_increase_on" date,
	"last_strategy_change_on" date,
	"paused_by_budget" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_log" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"actor" "actor" NOT NULL,
	"author" "change_author" NOT NULL,
	"action" jsonb NOT NULL,
	"object_kind" text NOT NULL,
	"object_id" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"status" "change_status" NOT NULL,
	"reason_code" text NOT NULL,
	"explanation" text NOT NULL,
	"turn_id" text,
	"reverted_by_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_confirmations" (
	"business_id" text NOT NULL,
	"week_start" date NOT NULL,
	"clients" integer NOT NULL,
	"leads" integer NOT NULL,
	CONSTRAINT "client_confirmations_business_id_week_start_pk" PRIMARY KEY("business_id","week_start")
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"business_id" text PRIMARY KEY NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"on" date NOT NULL,
	"ad_classes" jsonb NOT NULL,
	"direction_classes" jsonb NOT NULL,
	"borderline_since" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"ad_id" text NOT NULL,
	"hypothesis" text NOT NULL,
	"started_on" date NOT NULL,
	"status" text NOT NULL,
	"outcome" jsonb
);
--> statement-breakpoint
CREATE TABLE "heartbeats" (
	"name" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"business_id" text,
	"message" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform_accounts" (
	"business_id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"login" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"token_expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runtime_flags" (
	"name" text NOT NULL,
	"business_id" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_flags_name_business_id_pk" PRIMARY KEY("name","business_id")
);
--> statement-breakpoint
CREATE TABLE "stats_daily" (
	"business_id" text NOT NULL,
	"date" date NOT NULL,
	"platform_campaign_id" text NOT NULL,
	"platform_ad_id" text NOT NULL,
	"impressions" integer NOT NULL,
	"clicks" integer NOT NULL,
	"leads" integer NOT NULL,
	"cost_vat" bigint NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stats_daily_business_id_date_platform_ad_id_pk" PRIMARY KEY("business_id","date","platform_ad_id")
);
--> statement-breakpoint
CREATE TABLE "stats_intraday" (
	"business_id" text NOT NULL,
	"platform_ad_id" text NOT NULL,
	"impressions" integer NOT NULL,
	"clicks" integer NOT NULL,
	"leads" integer NOT NULL,
	"cost_vat" bigint NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stats_intraday_business_id_platform_ad_id_pk" PRIMARY KEY("business_id","platform_ad_id")
);
--> statement-breakpoint
CREATE TABLE "sync_cursors" (
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "sync_cursors_business_id_name_pk" PRIMARY KEY("business_id","name")
);
--> statement-breakpoint
CREATE TABLE "user_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"object_id" text NOT NULL,
	"command_type" text NOT NULL,
	"on" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_inbox" ADD CONSTRAINT "agent_inbox_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_notes" ADD CONSTRAINT "agent_notes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_turns" ADD CONSTRAINT "agent_turns_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_confirmations" ADD CONSTRAINT "client_confirmations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stats_daily" ADD CONSTRAINT "stats_daily_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stats_intraday" ADD CONSTRAINT "stats_intraday_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_decisions" ADD CONSTRAINT "user_decisions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ads_platform_id" ON "ads" USING btree ("platform_ad_id");--> statement-breakpoint
CREATE INDEX "ads_campaign" ON "ads" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_platform_id" ON "campaigns" USING btree ("platform_campaign_id");--> statement-breakpoint
CREATE INDEX "campaigns_business" ON "campaigns" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "change_log_business_time" ON "change_log" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "change_log_pending" ON "change_log" USING btree ("status") WHERE status = 'pending';