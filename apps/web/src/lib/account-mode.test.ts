import { describe, expect, it } from "vitest";
import { accountFromSignIn, accountMode, DEMO_LOGIN_PROVIDER, launchModeFor, TEST_LOGIN_PROVIDER, WIZARD_OUTDATED_MESSAGE } from "./account-mode";

describe("the account a sign-in creates (auth spec «Демо-вход»)", () => {
  it("creates a demo without email or name, whatever the provider passed along", () => {
    expect(accountFromSignIn(DEMO_LOGIN_PROVIDER, { id: "7f1c", email: "someone@example.com", name: "Анна" })).toEqual({ subject: "demo:7f1c", kind: "demo", email: null, name: null });
    expect(() => accountFromSignIn(DEMO_LOGIN_PROVIDER, {})).toThrow("no id");
  });

  it("keeps the test login's email and refuses it without one", () => {
    expect(accountFromSignIn(TEST_LOGIN_PROVIDER, { id: "test:a@b.c", email: "a@b.c", name: "Проверка" })).toEqual({ subject: "test:a@b.c", kind: "test", email: "a@b.c", name: "Проверка" });
    expect(() => accountFromSignIn(TEST_LOGIN_PROVIDER, { id: "x", email: null })).toThrow("no email");
  });

  it("refuses Google while its login is unavailable", () => {
    expect(() => accountFromSignIn("google", { id: "g1", email: "a@gmail.com" })).toThrow("not available");
  });
});

describe("the business mode follows the login (simulation-mode spec «Режим бизнеса «Симуляция»»)", () => {
  it("runs a demo only in the simulation and the other logins only in Direct", () => {
    expect(accountMode("demo")).toBe("simulation");
    expect(accountMode("google")).toBe("direct");
    expect(accountMode("test")).toBe("direct");
  });

  it("launches today's page, which sends no mode, in the account's mode", () => {
    expect(launchModeFor("demo", {})).toEqual({ ok: true, mode: "simulation" });
    expect(launchModeFor("test", {})).toEqual({ ok: true, mode: "direct" });
  });

  it("accepts a stale page that asks for the account's own mode", () => {
    expect(launchModeFor("demo", { simulation: true })).toEqual({ ok: true, mode: "simulation" });
    expect(launchModeFor("google", { simulation: false })).toEqual({ ok: true, mode: "direct" });
  });

  it("refuses a stale page that asks for the other mode instead of launching the account's", () => {
    expect(launchModeFor("test", { simulation: true })).toEqual({ ok: false, code: "WIZARD_OUTDATED", message: WIZARD_OUTDATED_MESSAGE });
    expect(launchModeFor("demo", { simulation: false })).toMatchObject({ ok: false, code: "WIZARD_OUTDATED" });
  });
});
