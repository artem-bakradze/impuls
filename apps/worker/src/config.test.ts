import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config";
import { createLogger, redact } from "./logger";

const complete = {
  DATABASE_URL: "postgres://x",
  DIRECT_API_MODE: "simulator",
  AGENT_RUNTIME: "idle",
  CREATIVES: "template",
  SMTP_URL: "smtp://localhost:1025",
  MAIL_FROM: "Импульс <noreply@impuls.test>",
  APP_URL: "https://app.example",
  TEAM_ALERT_EMAIL: "team@impuls.test",
  MINISITE_DIR: "/tmp/minisites",
};

/** The Agents API runtime with its prices and limits (ad-agent spec «Лимиты агента»). */
const openai = {
  AGENT_RUNTIME: "openai",
  OPENAI_API_KEY: "k",
  OPENAI_AGENT_MODEL: "gpt-6-luna",
  AGENT_PRICE_INPUT_RUB_PER_MTOK: "250",
  AGENT_PRICE_OUTPUT_RUB_PER_MTOK: "1000",
  AGENT_MONTHLY_LIMIT_RUB: "300",
  AGENT_SIMULATION_RUN_LIMIT_RUB: "100",
};

describe("loadConfig", () => {
  it("fails fast when a required variable is missing", () => {
    expect(() => loadConfig({ DIRECT_API_MODE: "simulator", AGENT_RUNTIME: "idle" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...complete, SMTP_URL: undefined })).toThrow(ConfigError);
    try {
      loadConfig({ DIRECT_API_MODE: "simulator", AGENT_RUNTIME: "idle" });
    } catch (error) {
      expect((error as ConfigError).problems.join()).toContain("DATABASE_URL");
    }
  });

  it("rejects unknown modes instead of falling back", () => {
    expect(() => loadConfig({ ...complete, DIRECT_API_MODE: "prod" })).toThrow(ConfigError);
  });

  it("refuses the retired sandbox mode and names the replacement", () => {
    expect(() => loadConfig({ ...complete, DIRECT_API_MODE: "sandbox" })).toThrow(/sandbox is no longer supported.*use simulator/);
  });

  it("accepts a complete configuration; the proxy is optional", () => {
    expect(loadConfig(complete)).toMatchObject({ DIRECT_API_MODE: "simulator" });
  });

  it("requires the OpenAI key and text model for LLM creatives", () => {
    expect(() => loadConfig({ ...complete, CREATIVES: "openai" })).toThrow(/OPENAI_API_KEY.*OPENAI_TEXT_MODEL/);
    expect(loadConfig({ ...complete, CREATIVES: "openai", OPENAI_API_KEY: "k", OPENAI_TEXT_MODEL: "gpt-6.1-terra" })).toMatchObject({ CREATIVES: "openai" });
    expect(() => loadConfig({ ...complete, CREATIVES: undefined })).toThrow(/CREATIVES/);
  });

  it("requires the OpenAI key, the agent model, its prices and the spend limits for the Agents API runtime", () => {
    expect(() => loadConfig({ ...complete, AGENT_RUNTIME: "openai" })).toThrow(/OPENAI_API_KEY.*OPENAI_AGENT_MODEL.*AGENT_PRICE_INPUT_RUB_PER_MTOK.*AGENT_MONTHLY_LIMIT_RUB.*AGENT_SIMULATION_RUN_LIMIT_RUB/);
    expect(loadConfig({ ...complete, ...openai })).toMatchObject({ AGENT_RUNTIME: "openai", AGENT_MONTHLY_LIMIT_RUB: 300 });
    expect(loadConfig({ ...complete, AGENT_RUNTIME: "heuristic" })).toMatchObject({ AGENT_RUNTIME: "heuristic" });
  });

  it("requires the token encryption key, the Yandex OAuth app and the agent on the model in production", () => {
    expect(() => loadConfig({ ...complete, DIRECT_API_MODE: "production" })).toThrow(/TOKEN_ENCRYPTION_KEY.*YANDEX_CLIENT_ID.*YANDEX_CLIENT_SECRET/);
    expect(() => loadConfig({ ...complete, DIRECT_API_MODE: "production", TOKEN_ENCRYPTION_KEY: "k" })).toThrow(/YANDEX_CLIENT_ID/);
    expect(
      loadConfig({ ...complete, ...openai, DIRECT_API_MODE: "production", TOKEN_ENCRYPTION_KEY: "k", YANDEX_CLIENT_ID: "cid", YANDEX_CLIENT_SECRET: "cs" }),
    ).toMatchObject({ DIRECT_API_MODE: "production" });
  });
});

describe("logger", () => {
  it("masks tokens, secrets and emails", () => {
    const lines: string[] = [];
    const logger = createLogger((line) => lines.push(line));
    logger.info("Direct call with OAuth y0_AgAAAAABCDEFGHIJKLMNOPQRSTUVWXYZ for owner@example.com", {
      accessToken: "y0_secret",
      request: { headers: { Authorization: "Bearer abc.def" }, body: "sk-abcdefghijklmnopqrstuvwxyz" },
      businessId: "b1",
    });
    const line = lines[0] ?? "";
    expect(line).not.toContain("y0_");
    expect(line).not.toContain("owner@example.com");
    expect(line).not.toContain("abc.def");
    expect(line).not.toContain("sk-abc");
    expect(JSON.parse(line)).toMatchObject({ level: "info", businessId: "b1", accessToken: "[redacted]" });
  });

  it("redacts nested errors", () => {
    expect(redact({ error: new Error("token y0_AgAAAAABCDEFGHIJKLMNOPQRSTUVWXYZ expired") })).toEqual({
      error: { name: "Error", message: "token [redacted] expired" },
    });
  });
});
