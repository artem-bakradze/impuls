import { describe, expect, it } from "vitest";
import { budgetPlan } from "./summary-model";
import { spendCurve } from "./spend-curve";

const day = (date: string, spend: number, leads: number | null = 1) => ({ date, leads, spend, decision: false });

describe("the month's money as a line against the even plan (analytics spec «Сводка»)", () => {
  it("adds up each day's spend and puts each day's end where the plan counts it", () => {
    const curve = spendCurve([day("2026-12-01", 70_000), day("2026-12-02", 50_000), day("2026-12-03", 80_000)], "2026-12-01", "2026-12-31", 3_000_000);
    expect(curve?.points.map((p) => p.spent)).toEqual([70_000, 120_000, 200_000]);
    expect(curve?.points.map((p) => p.at)).toEqual([1 / 31, 2 / 31, 3 / 31]);
    // The plan by a day's end is the budget times that share: the same as `budgetPlan`.
    const last = curve?.points.at(-1);
    expect(Math.round(3_000_000 * (last?.at ?? 0))).toBe(budgetPlan(3_000_000, "2026-12-01", "2026-12-31", "2026-12-03"));
  });

  it("starts the period at the launch in the month of the launch", () => {
    const curve = spendCurve([day("2026-12-15", 100_000)], "2026-12-15", "2026-12-31", 1_700_000);
    expect(curve?.points).toEqual([{ date: "2026-12-15", at: 1 / 17, spent: 100_000 }]);
  });

  it("stops at the last day with a report and leaves days outside the period out", () => {
    const curve = spendCurve([day("2026-11-30", 90_000), day("2026-12-01", 70_000), day("2026-12-02", 0, 0), day("2026-12-03", 0, null)], "2026-12-01", "2026-12-31", 3_000_000);
    expect(curve?.points.map((p) => p.date)).toEqual(["2026-12-01", "2026-12-02"]);
    expect(curve?.points.at(-1)?.spent).toBe(70_000);
  });

  it("has no line without a report or without a budget", () => {
    expect(spendCurve([day("2026-12-01", 0, null)], "2026-12-01", "2026-12-31", 3_000_000)).toBeNull();
    expect(spendCurve([day("2026-12-01", 70_000)], "2026-12-01", "2026-12-31", 0)).toBeNull();
  });
});
