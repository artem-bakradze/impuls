import { PlatformError } from "../contract";
import { mapDirectError, parseDirectErrorBody } from "./errors";

/** Production JSON API v5. The sandbox was shut down by Yandex on 2026-07-15, so there is no other base URL. */
export const DIRECT_BASE_URL = "https://api.direct.yandex.com/json/v5/";

/** Total attempts for an idempotent request, including the first one (platform-integration spec: at most 5). */
export const DIRECT_MAX_ATTEMPTS = 5;
/** Backoff before attempt N+1 is `DIRECT_RETRY_BASE_DELAY_MS * 2^(N-1)`: 1 s, 2 s, 4 s, 8 s. */
export const DIRECT_RETRY_BASE_DELAY_MS = 1_000;
/** Default bound for offline report polling (each poll waits `retryIn` seconds). */
export const DIRECT_DEFAULT_MAX_REPORT_POLLS = 20;
/** Used when Direct answers 201/202 without a usable `retryIn` header. */
export const DIRECT_DEFAULT_REPORT_RETRY_IN_SECONDS = 5;

/**
 * One journal entry per HTTP attempt. Never contains the token or request headers.
 * Spec requires keeping request/response logs for 3 days; persisting them is the logger's job.
 */
export interface DirectRequestLogEntry {
  service: string;
  method: string;
  attempt: number;
  /** HTTP status, null when the request failed before a response (network error). */
  status: number | null;
  requestId: string | null;
  /** Raw `Units` header: "spent/remaining/daily limit". */
  units: string | null;
  durationMs: number;
  outcome: "ok" | "error" | "report_pending";
  errorCode: string | null;
  willRetry: boolean;
}

export type DirectLogger = (entry: DirectRequestLogEntry) => void;

/**
 * Sees every request before it is sent (throwing blocks it) and every successful result. Used by the
 * contract-test guard to keep tests away from objects they did not create.
 */
export interface DirectRequestGuard {
  before(service: string, method: string, params: JsonRecord): void;
  after(service: string, method: string, params: JsonRecord, result: JsonRecord): void;
}

export interface DirectClientOptions {
  token: string;
  clientLogin?: string;
  fetch?: typeof fetch;
  logger: DirectLogger;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Monotonic-ish clock in ms used only for `durationMs`; defaults to `Date.now`. */
  clock?: () => number;
  maxReportPolls?: number;
  guard?: DirectRequestGuard;
}

export type JsonRecord = Record<string, unknown>;

interface AttemptOutcome<T> {
  value?: T;
  error?: PlatformError;
  status: number | null;
  requestId: string | null;
  units: string | null;
  pending?: boolean;
}

type ReportPoll = { ready: true; text: string } | { ready: false; seconds: number };

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Low-level JSON v5 + Reports client: auth headers, error mapping, bounded retries and request journal. */
export class DirectClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly clock: () => number;
  private readonly maxReportPolls: number;

  constructor(private readonly options: DirectClientOptions) {
    if (!options.token) {
      throw new Error("Yandex Direct token is required");
    }
    this.baseUrl = DIRECT_BASE_URL;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? realSleep;
    this.clock = options.clock ?? Date.now;
    this.maxReportPolls = options.maxReportPolls ?? DIRECT_DEFAULT_MAX_REPORT_POLLS;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.token}`,
      "Accept-Language": "ru",
      "Content-Type": "application/json; charset=utf-8",
      ...extra,
    };
    if (this.options.clientLogin) {
      headers["Client-Login"] = this.options.clientLogin;
    }
    return headers;
  }

  /**
   * Calls `<service>.<method>` and returns the `result` object.
   * Only `idempotent` calls are retried; mutations fail on the first error so the command executor
   * can re-check the current state before deciding to repeat them.
   */
  async call(service: string, method: string, params: JsonRecord, idempotent: boolean): Promise<JsonRecord> {
    this.options.guard?.before(service, method, params);
    const url = `${this.baseUrl}${service}`;
    const body = JSON.stringify({ method, params });
    const result = await this.withRetry<JsonRecord>(service, method, idempotent, async () => {
      const response = await this.fetchImpl(url, { method: "POST", headers: this.headers(), body });
      const meta = this.meta(response);
      const parsed = parseJson(await response.text());
      const directError = parseDirectErrorBody(parsed);
      if (directError) {
        return { ...meta, error: mapDirectError(directError) };
      }
      if (response.status >= 500) {
        return { ...meta, error: new PlatformError("DIRECT_UNAVAILABLE", `Direct HTTP ${response.status}`, true) };
      }
      if (!response.ok) {
        return { ...meta, error: new PlatformError("DIRECT_HTTP_ERROR", `Direct HTTP ${response.status}`, false) };
      }
      if (!isRecord(parsed) || !isRecord(parsed.result)) {
        return { ...meta, error: new PlatformError("DIRECT_INVALID_RESPONSE", `Direct ${service}.${method} returned no result`, false) };
      }
      return { ...meta, value: parsed.result };
    });
    this.options.guard?.after(service, method, params, result);
    return result;
  }

  /**
   * Requests a Reports TSV. Offline reports (HTTP 201/202) are polled with the same body,
   * waiting `retryIn` seconds, at most `maxReportPolls` times; then the call fails explicitly.
   */
  async report(params: JsonRecord): Promise<string> {
    this.options.guard?.before("reports", "get", params);
    const url = `${this.baseUrl}reports`;
    const body = JSON.stringify({ params });
    const headers = this.headers({ processingMode: "auto", returnMoneyInMicros: "false" });
    for (let poll = 0; poll <= this.maxReportPolls; poll++) {
      const result = await this.withRetry<ReportPoll>("reports", "get", true, async () => {
        const response = await this.fetchImpl(url, { method: "POST", headers, body });
        const meta = this.meta(response);
        const text = await response.text();
        if (response.status === 200) {
          return { ...meta, value: { ready: true, text } };
        }
        if (response.status === 201 || response.status === 202) {
          const retryIn = Number(response.headers.get("retryIn"));
          const seconds = Number.isFinite(retryIn) && retryIn > 0 ? retryIn : DIRECT_DEFAULT_REPORT_RETRY_IN_SECONDS;
          return { ...meta, pending: true, value: { ready: false, seconds } };
        }
        const directError = parseDirectErrorBody(parseJson(text));
        if (directError) {
          return { ...meta, error: mapDirectError(directError) };
        }
        const retryable = response.status >= 500;
        return {
          ...meta,
          error: new PlatformError(retryable ? "DIRECT_UNAVAILABLE" : "DIRECT_HTTP_ERROR", `Direct Reports HTTP ${response.status}`, retryable),
        };
      });
      if (result.ready) {
        return result.text;
      }
      if (poll < this.maxReportPolls) {
        await this.sleep(result.seconds * 1_000);
      }
    }
    throw new PlatformError("REPORT_NOT_READY", `Direct report not ready after ${this.maxReportPolls} polls`, true);
  }

  private meta(response: Response): Pick<AttemptOutcome<never>, "status" | "requestId" | "units"> {
    return {
      status: response.status,
      requestId: response.headers.get("RequestId"),
      units: response.headers.get("Units"),
    };
  }

  private async withRetry<T>(service: string, method: string, idempotent: boolean, attemptFn: () => Promise<AttemptOutcome<T>>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const started = this.clock();
      let outcome: AttemptOutcome<T>;
      try {
        outcome = await attemptFn();
      } catch (error) {
        outcome = {
          status: null,
          requestId: null,
          units: null,
          error: new PlatformError("DIRECT_NETWORK_ERROR", `Direct ${service}.${method} request failed: ${errorText(error)}`, true),
        };
      }
      const error = outcome.error;
      const willRetry = error !== undefined && idempotent && error.retryable && attempt < DIRECT_MAX_ATTEMPTS;
      this.options.logger({
        service,
        method,
        attempt,
        status: outcome.status,
        requestId: outcome.requestId,
        units: outcome.units,
        durationMs: this.clock() - started,
        outcome: error ? "error" : outcome.pending ? "report_pending" : "ok",
        errorCode: error?.code ?? null,
        willRetry,
      });
      if (!error) {
        return outcome.value as T;
      }
      if (!willRetry) {
        if (idempotent && error.retryable) {
          throw new PlatformError(error.code, `${error.message}; gave up after ${attempt} attempts`, true);
        }
        throw error;
      }
      await this.sleep(DIRECT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
}
