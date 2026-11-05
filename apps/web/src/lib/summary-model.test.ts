import { describe, expect, it } from "vitest";
import { mapJobState } from "./job-state";
import { loginErrorMessage } from "./login-error";
import { adsState, adsStateText, budgetPlan, compareText, goalBadge, goalExplanation, nextStepText, observedDaily, goalLine, moderationText } from "./summary-model";
import { formatRange, formatRub } from "./format";

const plain = (text: string) => text.replace(/ /g, " ");

describe("summary texts", () => {
  it("shows the goal line with the «дороже цели» status", () => {
    expect(plain(goalLine({ mode: "user", cso: 30_000, learned: false, current: 34_000, status: "above" }))).toBe("Цель: до 300 ₽ за обращение · Сейчас: 340 ₽ — дороже цели");
    expect(plain(goalLine({ mode: "user", cso: 30_000, learned: false, current: 25_000, status: "within" }))).toBe("Цель: до 300 ₽ за обращение · Сейчас: 250 ₽ — в цели");
  });

  it("shows no starting number while the automatic goal is not refined by own leads", () => {
    expect(plain(goalLine({ mode: "auto", cso: 150_000, learned: false, current: null, status: "no_data" }))).toBe("Цену обращения подбираем сами по вашим результатам · Сейчас: обращений пока нет");
    expect(plain(goalLine({ mode: "auto", cso: 60_000, learned: true, current: 55_000, status: "within" }))).toBe("Цель: подбираем сами, сейчас до 600 ₽ за обращение · Сейчас: 550 ₽ — в цели");
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

describe("observed daily results", () => {
  it("adds campaigns from the same day, preserves reported zero and leaves missing reports unknown", () => {
    const days = observedDaily("2026-12-01", "2026-12-04", [{ date: "2026-12-01", leads: 2, spend: 1_000 }, { date: "2026-12-01", leads: 3, spend: 2_000 }, { date: "2026-12-02", leads: 0, spend: 0 }], new Set(["2026-12-02"]));
    expect(days).toEqual([{ date: "2026-12-01", leads: 5, spend: 3_000, decision: false }, { date: "2026-12-02", leads: 0, spend: 0, decision: true }, { date: "2026-12-03", leads: null, spend: 0, decision: false }, { date: "2026-12-04", leads: null, spend: 0, decision: false }]);
    expect(days.reduce((sum, d) => sum + (d.leads ?? 0), 0)).toBe(5);
  });
});

describe("the answer's state, goal and budget pace (analytics spec «Сводка»)", () => {
  it("marks an even pace of the month budget by the data date", () => {
    expect(budgetPlan(3_000_000, "2026-11-01", "2026-11-30", "2026-11-09")).toBe(900_000);
    // The month of the launch counts from the launch day, like its prorated budget.
    expect(budgetPlan(96_700, "2026-10-30", "2026-10-31", "2026-10-30")).toBe(48_350);
    expect(budgetPlan(3_000_000, "2026-11-01", "2026-11-30", "2026-12-02")).toBe(3_000_000);
  });

  it("says whether the ads run, wait for Yandex or are not shown", () => {
    // The number of ads is the row «Объявления N»; the state only says the advertising runs.
    expect(adsStateText(adsState({ state: "running", simulation: true, moderationPending: 0, shown: 8 }))).toBe("реклама активна");
    expect(adsStateText(adsState({ state: "paused", simulation: false, moderationPending: 0, shown: 8 }))).toBe("на паузе");
    expect(adsStateText(adsState({ state: "first_day", simulation: false, moderationPending: 3, shown: 0 }))).toBe("на проверке Яндекса");
    expect(adsStateText(adsState({ state: "first_day", simulation: true, moderationPending: 3, shown: 0 }))).toBe("объявления не показываются");
    expect(adsStateText(adsState({ state: "running", simulation: false, moderationPending: 0, shown: 1 }))).toBe("реклама активна");
  });

  it("marks a met goal green and never a reference", () => {
    expect(goalBadge({ mode: "user", cso: 100_000, learned: false, current: 51_200, status: "within" })).toBe("дешевле цели на 48%");
    expect(goalBadge({ mode: "user", cso: 100_000, learned: false, current: 97_000, status: "within" })).toBe("в цели");
    expect(goalBadge({ mode: "user", cso: 30_000, learned: false, current: 34_000, status: "above" })).toBeNull();
    expect(goalBadge({ mode: "auto", cso: 100_000, learned: false, current: 51_200, status: "within" })).toBeNull();
    expect(goalBadge({ mode: "auto", cso: 60_000, learned: true, current: 30_000, status: "within" })).toBe("дешевле цели на 50%");
    expect(goalBadge({ mode: "user", cso: 30_000, learned: false, current: null, status: "no_data" })).toBeNull();
  });
});

describe("what the numbers cover and what comes next (analytics spec «Сводка»)", () => {
  it("names the period of the data, not one date", () => {
    expect(formatRange("2026-11-01", "2026-11-09")).toBe("1–9 ноября");
    expect(formatRange("2026-10-30", "2026-11-09")).toBe("30 октября — 9 ноября");
    expect(formatRange("2026-11-09", "2026-11-09")).toBe("9 ноября");
  });

  it("says the nearest check in the service's words, with how many more there are", () => {
    const check = { statement: "Проверяю, останется ли стоимость обращений с компьютеров ниже цели.", checkOn: "2026-11-16", more: 1 };
    expect(nextStepText(check, "2026-11-09")).toBe("16 ноября сервис проверит, останется ли стоимость обращений с компьютеров ниже цели · ещё 1 проверка");
    expect(nextStepText({ ...check, checkOn: "2026-11-10", more: 0 }, "2026-11-09")).toBe("завтра сервис проверит, останется ли стоимость обращений с компьютеров ниже цели");
    expect(nextStepText({ statement: "Новый заголовок приведёт больше обращений", checkOn: "2026-11-16", more: 3 }, "2026-11-09")).toBe("16 ноября — итог проверки: новый заголовок приведёт больше обращений · ещё 3 проверки");
  });

  it("falls back to the next morning's look without open checks", () => {
    expect(nextStepText(null, "2026-11-09")).toBe("завтра утром сервис снова посмотрит рекламу");
  });

  it("explains a reference, a refined goal and the owner's own", () => {
    expect(goalExplanation({ mode: "auto", learned: false })).toContain("бюджет месяца, делённый на 30");
    expect(goalExplanation({ mode: "auto", learned: true })).toContain("за последние 30 дней");
    expect(goalExplanation({ mode: "user", learned: false })).toContain("задали сами");
  });
});
