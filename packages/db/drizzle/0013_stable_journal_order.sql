DROP INDEX "change_log_business_time";--> statement-breakpoint
ALTER TABLE "change_log" ADD COLUMN "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "change_log_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
CREATE INDEX "change_log_business_time" ON "change_log" USING btree ("business_id","created_at","seq");