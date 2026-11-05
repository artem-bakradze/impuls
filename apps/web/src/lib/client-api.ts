import type { JobView } from "./job-state";

export type ApiOutcome<T> = { kind: "ok"; body: T } | { kind: "error"; code: string; message: string };
export type JobOutcome<T> = { kind: "done"; output: T } | { kind: "pending" } | { kind: "error"; code: string; message: string };

const NETWORK_ERROR = { kind: "error", code: "NETWORK", message: "Нет связи с сервисом. Проверьте интернет и попробуйте ещё раз" } as const;

export const callApi = async <T>(url: string, method: "POST" | "PUT" | "GET", body?: unknown): Promise<ApiOutcome<T>> => {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return NETWORK_ERROR;
  }
  const json = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const error = json as { code?: unknown; message?: unknown } | null;
    return {
      kind: "error",
      code: typeof error?.code === "string" ? error.code : `HTTP_${response.status}`,
      message: typeof error?.message === "string" ? error.message : "Что-то пошло не так. Попробуйте ещё раз",
    };
  }
  return { kind: "ok", body: json as T };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const POLL_INTERVAL_MS = 700;
export const POLL_ATTEMPTS = 40;

/**
 * Enqueues a worker job through an API route and waits for its result. If the worker is slow the outcome
 * is `pending`, and the UI says the change is being applied.
 */
export const runWebJob = async <T>(url: string, body: unknown, attempts = POLL_ATTEMPTS): Promise<JobOutcome<T>> => {
  const started = await callApi<{ jobId: string }>(url, "POST", body);
  return started.kind === "error" ? started : waitForJob<T>(started.body.jobId, attempts);
};

/** Reading pages and generating texts with the LLM takes longer than a settings change: up to ~90 s. */
export const LLM_POLL_ATTEMPTS = 130;

/** Same for routes that enqueue one job per direction (schedule, zone); outputs keep the job order. */
export const runWebJobs = async <T>(url: string, body: unknown): Promise<JobOutcome<T[]>> => {
  const started = await callApi<{ jobIds: string[] }>(url, "POST", body);
  if (started.kind === "error") {
    return started;
  }
  const outputs: T[] = [];
  for (const id of started.body.jobIds) {
    const outcome = await waitForJob<T>(id);
    if (outcome.kind !== "done") {
      return outcome;
    }
    outputs.push(outcome.output);
  }
  return { kind: "done", output: outputs };
};

export const waitForJob = async <T>(jobId: string, attempts = POLL_ATTEMPTS): Promise<JobOutcome<T>> => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    const polled = await callApi<JobView>(`/api/jobs/${encodeURIComponent(jobId)}`, "GET");
    if (polled.kind === "error") {
      return polled;
    }
    const view = polled.body;
    if (view.state === "done") {
      return { kind: "done", output: view.output as T };
    }
    if (view.state === "failed") {
      return { kind: "error", ...view.error };
    }
  }
  return { kind: "pending" };
};

/** ExecutionResult of a command job, as the worker returns it. */
export type CommandResult =
  | { status: "applied" | "clamped"; entryId: string; message: string }
  | { status: "rejected" | "failed"; code: string; message: string };

export const PENDING_TEXT = "Применяется… Это может занять до 15 минут, результат появится в истории";
