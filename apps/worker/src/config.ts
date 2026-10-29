import { z } from "zod";

/** The Direct sandbox was shut down by Yandex on 2026-07-15; an old `sandbox` value gets a pointed message. */
const directApiMode = z.enum(["simulator", "production"], {
  error: (issue) =>
    issue.input === "sandbox"
      ? "sandbox is no longer supported: Yandex shut the Direct sandbox down on 2026-07-15; use simulator"
      : "must be simulator or production",
});

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /** `simulator` runs the market simulator; `production` calls the real Direct API with each business's token. */
  DIRECT_API_MODE: directApiMode,
  /** Which AgentRuntime to run. Only policies exist until the Agents API spike (task 0.6). */
  AGENT_RUNTIME: z.enum(["idle"]),
  /** SMTP for notification emails, e.g. smtp://localhost:1025 (Mailpit locally). */
  SMTP_URL: z.string().min(1),
  MAIL_FROM: z.string().min(1),
  /** Where incidents are sent (team alert channel). */
  TEAM_ALERT_EMAIL: z.email(),
  /** Directory with published mini-sites (served as static files on the mini-site domain). */
  MINISITE_DIR: z.string().min(1),
  /** Public URL of the web app, used in email links. */
  APP_URL: z.url(),
  /**
   * Where ad texts, phrases and the business card come from: `openai` (LlmClient) or `template` (card-only
   * drafts for local stands and e2e). Chosen explicitly; there is no silent switch between them.
   */
  CREATIVES: z.enum(["template", "openai"]),
  /** Required with CREATIVES=openai. */
  OPENAI_API_KEY: z.string().min(1).optional(),
  /** Required with CREATIVES=openai, e.g. gpt-6.1-terra. */
  OPENAI_TEXT_MODEL: z.string().min(1).optional(),
  /** Optional: HTTPS proxy for OpenAI when hosted in Russia (design decision 12). */
  OPENAI_PROXY_URL: z.url().optional(),
  /** Required in production: key for the encrypted Direct OAuth tokens (base64, 32 bytes). */
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
}).superRefine((config, ctx) => {
  if (config.DIRECT_API_MODE === "production" && !config.TOKEN_ENCRYPTION_KEY) {
    ctx.addIssue({ code: "custom", path: ["TOKEN_ENCRYPTION_KEY"], message: "is required with DIRECT_API_MODE=production" });
  }
  if (config.CREATIVES === "openai") {
    for (const key of ["OPENAI_API_KEY", "OPENAI_TEXT_MODEL"] as const) {
      if (!config[key]) {
        ctx.addIssue({ code: "custom", path: [key], message: "is required with CREATIVES=openai" });
      }
    }
  }
});

export type WorkerConfig = z.infer<typeof ConfigSchema>;

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration: ${problems.join("; ")}`);
    this.name = "ConfigError";
  }
}

/** Validates required configuration at startup; missing values stop the process (No-Fallbacks policy). */
export const loadConfig = (env: Record<string, string | undefined>): WorkerConfig => {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  return result.data;
};
