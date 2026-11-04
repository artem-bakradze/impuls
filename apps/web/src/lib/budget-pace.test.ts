import { describe, expect, it } from "vitest";
import { budgetPace } from "./budget-pace";

const base = { monthBudget: 3_000_000, spent: 614_600, plan: 900_000, forecast: null, month: "2026-11" };

describe("the pace of the month's money in the studio (simulation-mode spec «Итог студии»)", () => {
  it("says how much less or more than the even plan is spent", () => {
    expect(budgetPace(base)).toEqual({ tone: "neutral", text: "тратим на 32% меньше плана" });
    expect(budgetPace({ ...base, spent: 1_035_000 })).toEqual({ tone: "warning", text: "тратим на 15% больше плана" });
  });

  it("calls less than 5% off the plan «по плану»", () => {
    expect(budgetPace({ ...base, spent: 870_000 })).toEqual({ tone: "good", text: "тратим по плану" });
    expect(budgetPace({ ...base, spent: 940_000 })).toEqual({ tone: "good", text: "тратим по плану" });
  });

  it("warns with the day the money runs out in this month, and says when the budget is spent", () => {
    const forecast = { left: 500_000, exhaustOn: "2026-11-27" };
    expect(budgetPace({ ...base, spent: 2_500_000, plan: 2_000_000, forecast })).toEqual({ tone: "warning", text: "хватит до 27 ноября" });
    expect(budgetPace({ ...base, spent: 2_500_000, plan: 2_400_000, forecast: { left: 500_000, exhaustOn: "2026-12-03" } })).toEqual({ tone: "good", text: "тратим по плану" });
    expect(budgetPace({ ...base, spent: 3_000_000, plan: 2_800_000, forecast: { left: 0, exhaustOn: "2026-11-28" } })).toEqual({ tone: "bad", text: "бюджет месяца потрачен" });
  });

  it("has no pace without a budget or a plan", () => {
    expect(budgetPace({ ...base, monthBudget: 0 })).toBeNull();
    expect(budgetPace({ ...base, plan: 0 })).toBeNull();
  });
});
