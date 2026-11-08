import { daysBetween } from "@impuls/core";
import type { Kopecks, LocalDate } from "@impuls/core";

/** The month's money as a line against the even plan (analytics spec «Сводка»). */
export interface SpendCurve {
  /** The budget period: the month, or from the launch day in the month of the launch, as the plan counts it. */
  from: LocalDate;
  to: LocalDate;
  budget: Kopecks;
  /** Money spent by the end of each reported day; `at` is that day's end as a share of the period, from 0 to 1. */
  points: { date: LocalDate; at: number; spent: Kopecks }[];
}

/**
 * Pure: what was spent by the end of each day of the budget period, the way the plan counts it — the plan of a day is
 * the budget times its share of the period (`budgetPlan`), so the line and the plan meet the same day ends. Days after
 * the last report are left out, so the line stops where the numbers do. Null without a report or a budget.
 */
export const spendCurve = (daily: readonly { date: LocalDate; leads: number | null; spend: number }[], from: LocalDate, to: LocalDate, budget: Kopecks): SpendCurve | null => {
  const days = daysBetween(from, to) + 1;
  if (budget <= 0 || days <= 0) return null;
  const inside = daily.filter((day) => day.date >= from && day.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const last = inside.findLastIndex((day) => day.leads !== null);
  if (last === -1) return null;
  let spent = 0;
  const points = inside.slice(0, last + 1).map((day) => {
    spent += day.spend;
    return { date: day.date, at: (daysBetween(from, day.date) + 1) / days, spent: Math.round(spent) };
  });
  return { from, to, budget, points };
};
