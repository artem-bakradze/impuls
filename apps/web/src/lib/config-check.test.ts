import { describe, expect, it } from "vitest";
import { parseWebConfig, WebConfigError } from "./config-check";

const valid = {
  DATABASE_URL: "postgres://impuls:impuls@localhost:54329/impuls",
  AUTH_SECRET: "x".repeat(32),
  AUTH_GOOGLE_ID: "id",
  AUTH_GOOGLE_SECRET: "secret",
  DIRECT_API_MODE: "simulator",
};

describe("web configuration", () => {
  it("refuses to start without a required value", () => {
    const rest: Record<string, string> = { ...valid };
    delete rest.AUTH_SECRET;
    expect(() => parseWebConfig(rest)).toThrow(WebConfigError);
  });

  it("keeps the test login off unless explicitly enabled", () => {
    expect(parseWebConfig(valid).AUTH_TEST_LOGIN).toBeUndefined();
    expect(parseWebConfig({ ...valid, AUTH_TEST_LOGIN: "enabled" }).AUTH_TEST_LOGIN).toBe("enabled");
    expect(() => parseWebConfig({ ...valid, AUTH_TEST_LOGIN: "yes" })).toThrow(WebConfigError);
  });

  it("never allows the test login in production", () => {
    expect(() => parseWebConfig({ ...valid, DIRECT_API_MODE: "production", AUTH_TEST_LOGIN: "enabled" })).toThrow(/AUTH_TEST_LOGIN/);
  });
});
