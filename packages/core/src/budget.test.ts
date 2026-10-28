import { describe, expect, it } from "vitest";
import { allowedWeeklyTotal, budgetSignal, fitLimits, maxFutureSpend, monthBudget } from "./budget";
import { weeksLeftInMonth } from "./dates";
import { rubles } from "./types";

describe("monthBudget", () => {
  it("prorates the launch month and rounds down to rubles", () => {
    // 15 000 ₽ × 7 / 31 = 3 387.09 ₽ (spec: запуск 25-го → 3 387 ₽)
    expect(monthBudget(15_000, "2026-10-25", "2026-10-25")).toBe(rubles(3_387));
    expect(monthBudget(15_000, "2026-10-25", "2026-10-31")).toBe(rubles(3_387));
  });

  it("uses the full budget from the next month", () => {
    expect(monthBudget(15_000, "2026-10-25", "2026-11-01")).toBe(rubles(15_000));
  });

  it("gives the full budget when launched on the 1st", () => {
    expect(monthBudget(15_000, "2026-11-01", "2026-11-10")).toBe(rubles(15_000));
  });

  it("is zero before launch", () => {
    expect(monthBudget(15_000, "2026-11-01", "2026-10-31")).toBe(0);
  });
});

describe("weeksLeftInMonth", () => {
  it("counts partial weeks as full", () => {
    // October 2026: the 1st is Thursday; weeks Sep 28, Oct 5, 12, 19, 26 → 5 weeks
    expect(weeksLeftInMonth("2026-10-01")).toBe(5);
    // Oct 26 (Monday) to Oct 31 → 1 week
    expect(weeksLeftInMonth("2026-10-26")).toBe(1);
    // Oct 25 is Sunday → its week plus the week of Oct 26
    expect(weeksLeftInMonth("2026-10-25")).toBe(2);
  });
});

describe("platform-side protection", () => {
  it("keeps spent + max future spend within 90% of the month budget", () => {
    const budget = rubles(20_000);
    const spent = rubles(5_000);
    const today = "2026-10-12";
    const allowed = allowedWeeklyTotal(spent, budget, today);
    expect(spent + maxFutureSpend([allowed], today)).toBeLessThanOrEqual(budget * 0.9);
    expect(spent + maxFutureSpend([allowed + 100], today)).toBeGreaterThan(budget * 0.9);
  });

  it("scales limits proportionally", () => {
    const fitted = fitLimits(
      [
        { directionId: "a", weeklyLimit: rubles(3_000), rank: 2 },
        { directionId: "b", weeklyLimit: rubles(1_000), rank: 1 },
      ],
      rubles(2_000),
      rubles(300),
    );
    expect(fitted.paused).toEqual([]);
    expect(fitted.limits.get("a")).toBe(rubles(1_500));
    expect(fitted.limits.get("b")).toBe(rubles(500));
  });

  it("pauses the lowest-ranked directions when the minimum limit cannot be kept", () => {
    const fitted = fitLimits(
      [
        { directionId: "best", weeklyLimit: rubles(2_000), rank: 3 },
        { directionId: "mid", weeklyLimit: rubles(2_000), rank: 2 },
        { directionId: "worst", weeklyLimit: rubles(2_000), rank: 1 },
      ],
      rubles(700),
      rubles(300),
    );
    expect(fitted.paused).toEqual(["worst"]);
    expect([...fitted.limits.keys()]).toEqual(["best", "mid"]);
    expect([...fitted.limits.values()].every((limit) => limit >= rubles(300))).toBe(true);
  });
});

describe("budgetSignal", () => {
  it("notifies at 80% and stops at 95%", () => {
    expect(budgetSignal(rubles(7_999), rubles(10_000))).toBe("ok");
    expect(budgetSignal(rubles(8_000), rubles(10_000))).toBe("notify");
    expect(budgetSignal(rubles(9_500), rubles(10_000))).toBe("stop");
  });
});
