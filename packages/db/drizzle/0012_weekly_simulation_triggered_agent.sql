ALTER TABLE "evaluations" ADD COLUMN "findings" jsonb;--> statement-breakpoint
ALTER TABLE "simulations" ADD COLUMN "steps" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "simulations" ADD COLUMN "replay" jsonb;--> statement-breakpoint
-- The virtual time no longer runs by itself (simulation-mode «Виртуальное время и пульт»): running simulations stop.
UPDATE "simulations" SET "status" = 'paused', "last_tick_at" = NULL WHERE "status" IN ('running', 'until_decision');
