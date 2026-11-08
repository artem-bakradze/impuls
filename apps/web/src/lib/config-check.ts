import { z } from "zod";

/**
 * Web configuration (No-Fallbacks policy): every required value must be set, otherwise the app does not start.
 * `AUTH_TEST_LOGIN=enabled` turns on the e2e-only email login; it is off unless set explicitly and is refused
 * together with `DIRECT_API_MODE=production`.
 */
/** The Direct sandbox was shut down by Yandex on 2026-07-15; an old `sandbox` value gets a pointed message. */
const directApiMode = z.enum(["simulator", "production"], {
  error: (issue) =>
    issue.input === "sandbox"
      ? "sandbox is no longer supported: Yandex shut the Direct sandbox down on 2026-07-15; use simulator"
      : "must be simulator or production",
});

/** Needed only to connect real Direct accounts (OAuth app «для авторизации пользователей»). */
const PRODUCTION_ONLY = ["YANDEX_CLIENT_ID", "YANDEX_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY", "APP_URL"] as const;

const ConfigSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
    // No Google OAuth app: the Google login is off for now (auth spec «Вход через Google пока недоступен»).
    DIRECT_API_MODE: directApiMode,
    /** Support address shown in the settings: account deletion is done on request (auth spec). */
    SUPPORT_EMAIL: z.email(),
    YANDEX_CLIENT_ID: z.string().min(1).optional(),
    YANDEX_CLIENT_SECRET: z.string().min(1).optional(),
    /** Key for the encrypted Direct OAuth tokens (base64, 32 bytes). */
    TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
    /** Public URL of the app; the Direct OAuth redirect URI is built from it. */
    APP_URL: z.url().optional(),
    /** Optional, documented: test-only login for e2e. Off when absent. */
    AUTH_TEST_LOGIN: z.enum(["enabled"]).optional(),
  })
  .refine((c) => !(c.AUTH_TEST_LOGIN === "enabled" && c.DIRECT_API_MODE === "production"), {
    message: "AUTH_TEST_LOGIN must not be enabled with DIRECT_API_MODE=production",
    path: ["AUTH_TEST_LOGIN"],
  })
  .superRefine((config, ctx) => {
    if (config.DIRECT_API_MODE !== "production") {
      return;
    }
    for (const key of PRODUCTION_ONLY) {
      if (!config[key]) {
        ctx.addIssue({ code: "custom", path: [key], message: "is required with DIRECT_API_MODE=production" });
      }
    }
  });

export type WebConfig = z.infer<typeof ConfigSchema>;

export class WebConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid web configuration: ${problems.join("; ")}`);
    this.name = "WebConfigError";
  }
}

export const parseWebConfig = (env: Record<string, string | undefined>): WebConfig => {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new WebConfigError(result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  return result.data;
};

let cached: WebConfig | null = null;

/** Validated once per process; instrumentation calls it at startup so a bad config stops the server. */
export const webConfig = (): WebConfig => {
  cached ??= parseWebConfig(process.env);
  return cached;
};
