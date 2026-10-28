import { z } from "zod";

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  /** `simulator` runs the local stand; real Direct modes need the adapter (task 3.3). */
  DIRECT_API_MODE: z.enum(["simulator", "sandbox", "production"]),
  /** Which AgentRuntime to run. Only policies exist until the Agents API spike (task 0.6). */
  AGENT_RUNTIME: z.enum(["idle"]),
  /** Optional: HTTPS proxy for OpenAI when hosted in Russia (design decision 12). */
  OPENAI_PROXY_URL: z.url().optional(),
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
