import type { PgBoss } from "pg-boss";
import type { JobContext } from "./context";
import { dispatchHour } from "./dispatcher";
import type { Logger } from "./logger";
import { deliverIncidents, deliverNotifications, queueWeeklySummary } from "./email";
import type { Mailer } from "./email";
import { handleWebJob, WEB_JOB_QUEUE } from "./web-jobs";
import type { WebJob } from "./web-jobs";

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
  notifications?: { mailer: Mailer; appUrl: string; teamEmail: string },
): Promise<void> => {
  await boss.createQueue(DISPATCH_QUEUE, { policy: "singleton", retryLimit: 0 });
  await boss.schedule(DISPATCH_QUEUE, "0 * * * *", null, { tz: "UTC" });
  await boss.createQueue(WEB_JOB_QUEUE, { retryLimit: 0 });
  await boss.work<WebJob>(WEB_JOB_QUEUE, async ([job]) => {
    if (!job) {
      return null;
    }
    logger.info("Web job received", { kind: job.data.kind, businessId: job.data.businessId, jobId: job.id });
    return handleWebJob(ctx, job.data);
  });
  await boss.work(DISPATCH_QUEUE, async () => {
    const started = Date.now();
    try {
      beforeDispatch();
      await dispatchHour(ctx);
      if (notifications) {
        for (const business of await ctx.store.listBusinesses()) {
          await queueWeeklySummary(ctx, business.id, notifications.appUrl);
        }
        await deliverNotifications(ctx, notifications.mailer, logger);
        await deliverIncidents(ctx, notifications.mailer, notifications.teamEmail);
      }
      logger.info("Hourly dispatch completed", { durationMs: Date.now() - started });
    } catch (error) {
      logger.error("Hourly dispatch failed", { error });
      throw error;
    }
  });
};
