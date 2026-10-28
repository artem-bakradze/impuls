import { PlatformError } from "../contract";

/**
 * Direct API v5 error codes, see https://yandex.ru/dev/direct/doc/ref-v5/concepts/errors-list.html
 *
 * Transient codes that are safe to retry for idempotent requests:
 * - 52   "Сервер авторизации временно недоступен"
 * - 506  "Превышено ограничение на количество соединений" (concurrency limit, clears by itself)
 * - 1000 "Сервер временно недоступен"
 * - 1001 "Ошибка инициализации сервиса"
 * - 1002 "Ошибка операции"
 */
export const RETRYABLE_DIRECT_ERROR_CODES: ReadonlySet<number> = new Set([52, 506, 1000, 1001, 1002]);

/** 53 "Ошибка авторизации" (invalid/revoked token), 58 "Незавершенная регистрация" (application access not approved). */
export const AUTH_DIRECT_ERROR_CODES: ReadonlySet<number> = new Set([53, 58]);

/** 152 "Недостаточно баллов". Not retried: points recover over time, the scheduler defers work (platform-integration spec). */
export const POINTS_EXHAUSTED_DIRECT_ERROR_CODE = 152;

export const OBJECT_NOT_FOUND_DIRECT_ERROR_CODE = 8800;

/**
 * Direct documents no dedicated error code for missing advertiser data / ad marking (Yandex ORD, ERID):
 * the v5 error list was checked and has none. Such rejections are therefore detected by message text,
 * independent of the numeric code (they may arrive as top-level errors or per-object errors).
 * NEEDS VERIFICATION against real sandbox/production responses; extend the patterns when observed.
 */
export const ADVERTISER_DATA_PATTERNS: readonly RegExp[] = [
  /маркир/i,
  /\bОРД\b/u,
  /\berid\b/i,
  /данн\S*\s+(о\s+)?рекламодател/i,
  /рекламодател\S*\s+не\s+заполн/i,
  /advertiser data/i,
  /ad marking/i,
];

export interface DirectErrorPayload {
  code: number;
  message: string;
  detail: string;
}

const isAdvertiserDataError = (payload: DirectErrorPayload): boolean =>
  ADVERTISER_DATA_PATTERNS.some((pattern) => pattern.test(payload.message) || pattern.test(payload.detail));

const describe = (payload: DirectErrorPayload): string =>
  `Direct error ${payload.code}: ${payload.message}${payload.detail ? ` (${payload.detail})` : ""}`;

/** Maps a Direct error (request-level or per-object) to a stable `PlatformError` code. */
export const mapDirectError = (payload: DirectErrorPayload): PlatformError => {
  const message = describe(payload);
  if (isAdvertiserDataError(payload)) {
    return new PlatformError("ADVERTISER_DATA_REQUIRED", message, false);
  }
  if (AUTH_DIRECT_ERROR_CODES.has(payload.code)) {
    return new PlatformError("DIRECT_TOKEN_REVOKED", message, false);
  }
  if (payload.code === POINTS_EXHAUSTED_DIRECT_ERROR_CODE) {
    return new PlatformError("POINTS_EXHAUSTED", message, false);
  }
  if (RETRYABLE_DIRECT_ERROR_CODES.has(payload.code)) {
    return new PlatformError("DIRECT_UNAVAILABLE", message, true);
  }
  if (payload.code === OBJECT_NOT_FOUND_DIRECT_ERROR_CODE) {
    return new PlatformError("NOT_FOUND", message, false);
  }
  return new PlatformError(`DIRECT_ERROR_${payload.code}`, message, false);
};

/** Parses the `{ error: { error_code, error_string, error_detail } }` body; returns null for anything else. */
export const parseDirectErrorBody = (body: unknown): DirectErrorPayload | null => {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return null;
  }
  const error: unknown = body.error;
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const record = error as Record<string, unknown>;
  const code = Number(record.error_code);
  if (!Number.isInteger(code)) {
    return null;
  }
  return {
    code,
    message: typeof record.error_string === "string" ? record.error_string : "",
    detail: typeof record.error_detail === "string" ? record.error_detail : "",
  };
};
