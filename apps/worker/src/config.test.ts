import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config";
import { createLogger, redact } from "./logger";

describe("loadConfig", () => {
  it("fails fast when a required variable is missing", () => {
    expect(() => loadConfig({ DIRECT_API_MODE: "simulator", AGENT_RUNTIME: "idle" })).toThrow(ConfigError);
    try {
      loadConfig({ DIRECT_API_MODE: "simulator", AGENT_RUNTIME: "idle" });
    } catch (error) {
      expect((error as ConfigError).problems.join()).toContain("DATABASE_URL");
    }
  });

  it("rejects unknown modes instead of falling back", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgres://x", DIRECT_API_MODE: "prod", AGENT_RUNTIME: "idle" })).toThrow(ConfigError);
  });

  it("accepts a complete configuration; the proxy is optional", () => {
    expect(loadConfig({ DATABASE_URL: "postgres://x", DIRECT_API_MODE: "sandbox", AGENT_RUNTIME: "idle" })).toMatchObject({ DIRECT_API_MODE: "sandbox" });
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
