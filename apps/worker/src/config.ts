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
  /**
   * Which AgentRuntime decides: `openai` (Agents API; required with DIRECT_API_MODE=production), `heuristic` (a free
   * deterministic agent for stands and e2e) or `idle` (no agent: guards and safety net only).
   */
  AGENT_RUNTIME: z.enum(["idle", "heuristic", "openai"]),
  /** Required with AGENT_RUNTIME=openai, e.g. gpt-6.1-sol (docs/research/agents-api.md). */
  OPENAI_AGENT_MODEL: z.string().min(1).optional(),
  /** Required with AGENT_RUNTIME=openai: model price, rubles per million input / output tokens (ad-agent spec). */
  AGENT_PRICE_INPUT_RUB_PER_MTOK: z.coerce.number().positive().optional(),
  AGENT_PRICE_OUTPUT_RUB_PER_MTOK: z.coerce.number().positive().optional(),
  /** Required with AGENT_RUNTIME=openai: model spend per business per month and per simulation run, rubles. */
  AGENT_MONTHLY_LIMIT_RUB: z.coerce.number().positive().optional(),
  AGENT_SIMULATION_RUN_LIMIT_RUB: z.coerce.number().positive().optional(),
  /**
   * Optional: the model of the weekly review (add-agent-analyst-stage1 decision 7), e.g. gpt-6.1-sol; without it the
   * review runs on OPENAI_AGENT_MODEL. With it, its prices in rubles per million tokens are required.
   */
  OPENAI_STRATEGY_MODEL: z.string().min(1).optional(),
  AGENT_STRATEGY_PRICE_INPUT_RUB_PER_MTOK: z.coerce.number().positive().optional(),
  AGENT_STRATEGY_PRICE_OUTPUT_RUB_PER_MTOK: z.coerce.number().positive().optional(),
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
  /** Required in production: the user-authorization OAuth app that refreshes the Direct tokens. */
  YANDEX_CLIENT_ID: z.string().min(1).optional(),
  YANDEX_CLIENT_SECRET: z.string().min(1).optional(),
}).superRefine((config, ctx) => {
  if (config.DIRECT_API_MODE === "production") {
    for (const key of ["TOKEN_ENCRYPTION_KEY", "YANDEX_CLIENT_ID", "YANDEX_CLIENT_SECRET"] as const) {
      if (!config[key]) {
        ctx.addIssue({ code: "custom", path: [key], message: "is required with DIRECT_API_MODE=production" });
      }
    }
  }
  if (config.CREATIVES === "openai") {
    for (const key of ["OPENAI_API_KEY", "OPENAI_TEXT_MODEL"] as const) {
      if (!config[key]) {
        ctx.addIssue({ code: "custom", path: [key], message: "is required with CREATIVES=openai" });
      }
    }
  }
  if (config.AGENT_RUNTIME === "openai") {
    const required = [
      "OPENAI_API_KEY",
      "OPENAI_AGENT_MODEL",
      "AGENT_PRICE_INPUT_RUB_PER_MTOK",
      "AGENT_PRICE_OUTPUT_RUB_PER_MTOK",
      "AGENT_MONTHLY_LIMIT_RUB",
      "AGENT_SIMULATION_RUN_LIMIT_RUB",
    ] as const;
    for (const key of required) {
      if (!config[key]) {
        ctx.addIssue({ code: "custom", path: [key], message: "is required with AGENT_RUNTIME=openai" });
      }
    }
  }
  if (config.OPENAI_STRATEGY_MODEL) {
    if (config.AGENT_RUNTIME !== "openai") {
      ctx.addIssue({ code: "custom", path: ["OPENAI_STRATEGY_MODEL"], message: "needs AGENT_RUNTIME=openai" });
    }
    for (const key of ["AGENT_STRATEGY_PRICE_INPUT_RUB_PER_MTOK", "AGENT_STRATEGY_PRICE_OUTPUT_RUB_PER_MTOK"] as const) {
      if (!config[key]) {
        ctx.addIssue({ code: "custom", path: [key], message: "is required with OPENAI_STRATEGY_MODEL" });
      }
    }
  }
  // The agent decides by default (add-agent-insights decision 6): real ads run with the model, not without it.
  if (config.DIRECT_API_MODE === "production" && config.AGENT_RUNTIME !== "openai") {
    ctx.addIssue({ code: "custom", path: ["AGENT_RUNTIME"], message: "must be openai with DIRECT_API_MODE=production" });
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
