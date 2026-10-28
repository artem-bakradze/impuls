import type { PgBoss } from "pg-boss";
import type { JobContext } from "./context";
import { dispatchHour } from "./dispatcher";
import type { Logger } from "./logger";

export const DISPATCH_QUEUE = "dispatch-hour";

/**
 * Production wiring of job handlers to pg-boss (design decision 2): one hourly dispatcher job,
 * a singleton queue so two workers never dispatch the same hour, and no automatic retries.
 */
export const startScheduler = async (
  boss: PgBoss,
  ctx: JobContext,
  logger: Logger,
  beforeDispatch: () => void = () => undefined,
): Promise<void> => {
  await boss.createQueue(DISPATCH_QUEUE, { policy: "singleton", retryLimit: 0 });
  await boss.schedule(DISPATCH_QUEUE, "0 * * * *", null, { tz: "UTC" });
  await boss.work(DISPATCH_QUEUE, async () => {
    const started = Date.now();
    try {
      beforeDispatch();
      await dispatchHour(ctx);
      logger.info("Hourly dispatch completed", { durationMs: Date.now() - started });
    } catch (error) {
      logger.error("Hourly dispatch failed", { error });
      throw error;
    }
  });
};
