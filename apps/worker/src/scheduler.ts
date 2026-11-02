import type { PgBoss } from "pg-boss";
import type { JobContext } from "./context";
import { dispatchHour } from "./dispatcher";
import type { Logger } from "./logger";
import { deliverIncidents, deliverNotifications } from "./email";
import type { Mailer } from "./email";
import { handleWebJob, WEB_JOB_QUEUE } from "./web-jobs";
import type { WebJob } from "./web-jobs";

export const DISPATCH_QUEUE = "dispatch-hour";

/** Name, code and message of an error and of its causes, for the log. */
export const describeError = (error: unknown): { name: string; code: string | null; message: string }[] => {
  const chain: { name: string; code: string | null; message: string }[] = [];
  let current: unknown = error;
  while (current instanceof Error && chain.length < 5) {
    const code = (current as { code?: unknown }).code;
    chain.push({ name: current.name, code: typeof code === "string" ? code : null, message: current.message });
    current = current.cause;
  }
  if (chain.length === 0) {
    chain.push({ name: "NonError", code: null, message: String(error) });
  }
  return chain;
};

/** Web jobs one worker runs at the same time. */
export const WEB_JOB_CONCURRENCY = 5;

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
  // Owners' jobs run side by side: a minute-long «+1 день» with agent turns must not hold up anyone else's rollback.
  // Jobs of one business are kept in order by the business and simulation locks.
  await boss.work<WebJob>(WEB_JOB_QUEUE, { localConcurrency: WEB_JOB_CONCURRENCY }, async ([job]) => {
    if (!job) {
      return null;
    }
    logger.info("Web job received", { kind: job.data.kind, businessId: job.data.businessId, jobId: job.id });
    try {
      return await handleWebJob(ctx, job.data);
    } catch (error) {
      // The owner gets a plain message from the job state; the log keeps the technical reason (no card texts).
      logger.error("Web job failed", { kind: job.data.kind, businessId: job.data.businessId, jobId: job.id, error: describeError(error) });
      throw error;
    }
  });
  await boss.work(DISPATCH_QUEUE, async () => {
    const started = Date.now();
    try {
      beforeDispatch();
      await dispatchHour(ctx);
      if (notifications) {
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
