import "server-only";
import { WEB_JOB_QUEUE } from "@impuls/worker";
import type { WebJob } from "@impuls/worker";
import { mapJobState } from "../job-state";
import type { JobView } from "../job-state";
import { ApiError } from "./errors";
import { logger } from "./logger";
import { boss } from "./runtime";

const workerNotReady = () => new ApiError(503, "WORKER_NOT_READY", "Сервис сейчас перезапускается. Попробуйте через минуту");

/**
 * The only way web changes ads (design decision 3): a job for the worker. The worker owns the queue,
 * so a missing queue means it has not started yet.
 */
export const enqueueWebJob = async (job: WebJob): Promise<string> => {
  let client;
  try {
    client = await boss();
  } catch (error) {
    logger.error("Job queue is unavailable", { error });
    throw workerNotReady();
  }
  if ((await client.getQueue(WEB_JOB_QUEUE)) === null) {
    throw workerNotReady();
  }
  const id = await client.send(WEB_JOB_QUEUE, job);
  if (id === null) {
    throw new Error("pg-boss refused the web job");
  }
  logger.info("Web job enqueued", { kind: job.kind, businessId: job.businessId, jobId: id });
  return id;
};

/** Job state for polling; a job of another business looks the same as a missing one. */
export const readWebJob = async (businessId: string, id: string): Promise<JobView> => {
  const client = await boss();
  const job = await client.getJobById<WebJob>(WEB_JOB_QUEUE, id);
  if (!job || job.data.businessId !== businessId) {
    throw new ApiError(404, "JOB_NOT_FOUND", "Действие не найдено");
  }
  const view = mapJobState(job.state, job.output);
  if (view.state === "failed") {
    logger.warn("Web job failed", { jobId: id, kind: job.data.kind, businessId, errorCode: view.error.code });
  }
  return view;
};
