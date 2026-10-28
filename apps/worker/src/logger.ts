export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const SECRET_KEY = /token|secret|password|authorization|cookie|api[_-]?key/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const BEARER = /\b(Bearer|OAuth)\s+[\w.~+/-]+=*/gi;
const YANDEX_TOKEN = /\b(y[0-3]_[\w-]{20,}|AQAAAA[\w-]{20,})\b/g;
const OPENAI_KEY = /\bsk-[\w-]{20,}\b/g;

/** Masks secrets and personal data before anything is written (AGENTS.md, observability rules). */
export const redact = (value: unknown, key = ""): unknown => {
  if (SECRET_KEY.test(key)) {
    return "[redacted]";
  }
  if (typeof value === "string") {
    return value.replace(BEARER, "$1 [redacted]").replace(YANDEX_TOKEN, "[redacted]").replace(OPENAI_KEY, "[redacted]").replace(EMAIL, "[email]");
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message) };
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  return value;
};

export interface Logger {
  log(level: LogLevel, message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/** Structured JSON logs in English with correlation fields (businessId, commandId, turnId). */
export const createLogger = (write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): Logger => {
  const log = (level: LogLevel, message: string, fields: LogFields = {}): void => {
    write(JSON.stringify({ time: new Date().toISOString(), level, message: redact(message), ...(redact(fields) as LogFields) }));
  };
  return {
    log,
    info: (message, fields) => log("info", message, fields),
    warn: (message, fields) => log("warn", message, fields),
    error: (message, fields) => log("error", message, fields),
  };
};
