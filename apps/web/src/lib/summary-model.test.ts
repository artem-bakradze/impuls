import { describe, expect, it } from "vitest";
import { mapJobState } from "./job-state";
import { loginErrorMessage } from "./login-error";
import { compareText, goalLine, moderationText } from "./summary-model";
import { formatRub } from "./format";

const plain = (text: string) => text.replace(/ /g, " ");

describe("summary texts", () => {
  it("shows the goal line with the «дороже цели» status", () => {
    expect(plain(goalLine({ mode: "user", cso: 30_000, current: 34_000, status: "above" }))).toBe("Цель: до 300 ₽ за обращение · Сейчас: 340 ₽ — дороже цели");
    expect(plain(goalLine({ mode: "user", cso: 30_000, current: 25_000, status: "within" }))).toBe("Цель: до 300 ₽ за обращение · Сейчас: 250 ₽ — в цели");
  });

  it("compares with the previous period", () => {
    expect(plain(compareText(11, 7, String))).toBe("больше на 4, чем в прошлом периоде");
    expect(compareText(5, 5, String)).toBe("как в прошлом периоде");
    expect(plain(compareText(120_000, 150_000, formatRub))).toBe("меньше на 300 ₽, чем в прошлом периоде");
  });

  it("describes moderation in plain words", () => {
    expect(moderationText({ pending: 2, accepted: 0, rejected: 0 })).toBe("Яндекс проверяет объявления, обычно это занимает несколько часов");
  });
});

describe("job results", () => {
  it("passes known worker messages through and hides the rest", () => {
    expect(mapJobState("failed", { code: "CLIENTS_OUT_OF_RANGE", message: "Укажите число от 0 до 11" })).toEqual({ state: "failed", error: { code: "CLIENTS_OUT_OF_RANGE", message: "Укажите число от 0 до 11" } });
    const hidden = mapJobState("failed", { message: "Approval x is not pending", stack: "Error: ..." });
    expect(hidden.state === "failed" && hidden.error.message).not.toMatch(/Approval/);
    expect(mapJobState("active", null)).toEqual({ state: "pending" });
    expect(mapJobState("completed", { ok: true })).toEqual({ state: "done", output: { ok: true } });
  });
});

describe("login errors", () => {
  it("explains a cancelled Google login", () => {
    expect(loginErrorMessage("OAuthCallbackError")).toBe("Вход отменён. Чтобы продолжить, войдите через Google ещё раз");
    expect(loginErrorMessage(undefined)).toBeNull();
  });
});
