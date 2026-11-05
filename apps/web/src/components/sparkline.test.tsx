import { describe, expect, it } from "vitest";
import { evenPeriods } from "@/lib/summary-model";
import { dayHint, trendOf } from "./summary/Sparkline";

describe("a simulation's periods on the chart (analytics spec «Сводка»)", () => {
  const day = (date: string, leads: number | null, spend: number) => ({ date, leads, spend, decision: false });

  it("shares a period's spend and leads evenly by its days, so every day has the period's price", () => {
    // Days 9–15 got 3 leads on three of them and 1 800 ₽ on six; day 8 is another period.
    const daily = [day("2026-11-08", 1, 30_000), day("2026-11-09", 1, 30_000), day("2026-11-10", 0, 30_000), day("2026-11-11", 1, 30_000), day("2026-11-12", 0, 30_000), day("2026-11-13", 1, 30_000), day("2026-11-14", 0, 30_000), day("2026-11-15", null, 0)];
    const even = evenPeriods(daily, [{ from: "2026-11-09", to: "2026-11-15" }]);
    const points = trendOf(even);
    expect(points.map((p) => p.value)).toEqual([30_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000]);
    expect(points.some((p) => p.noLeads)).toBe(false);
    // The day outside the period keeps its own numbers, and the period adds up to what was entered.
    expect(even[0]).toEqual(day("2026-11-08", 1, 30_000));
    expect(even.slice(1).reduce((s, d) => s + (d.leads ?? 0), 0)).toBeCloseTo(3);
    expect(dayHint(points[1]!).replace(/ /g, " ")).toBe("9 ноября · 600 ₽ за обращение в среднем за период");
  });

  it("keeps a period without leads «без обращений» on every day", () => {
    const even = evenPeriods([day("2026-11-01", 0, 40_000), day("2026-11-02", null, 0), day("2026-11-03", 0, 20_000)], [{ from: "2026-11-01", to: "2026-11-03" }]);
    expect(trendOf(even).map((p) => [p.value, p.noLeads])).toEqual([
      [null, true],
      [null, true],
      [null, true],
    ]);
  });

  it("leaves a period without any report out of the chart", () => {
    const daily = [day("2026-11-01", null, 0), day("2026-11-02", null, 0)];
    expect(evenPeriods(daily, [{ from: "2026-11-01", to: "2026-11-02" }])).toEqual(daily);
  });
});
