import { calendarWords } from "./day-words";
import type { DayWords } from "./day-words";

export interface BudgetPace {
  tone: "good" | "bad" | "warning" | "neutral";
  text: string;
}

/** How far from the plan, in percent of it, still reads as «по плану». */
export const ON_PLAN_PERCENT = 5;

/**
 * The pace of the month's money in words, the result of the studio's «Потрачено» (simulation-mode spec «Итог студии»).
 * The plan is the even pace of `budgetPlan`; the forecast is `budgetForecast`, which exists from 80% of the budget.
 */
export const budgetPace = (input: {
  monthBudget: number;
  spent: number;
  plan: number;
  forecast: { left: number; exhaustOn: string | null } | null;
  /** The month of the data, «2026-11»: a forecast day after it is not a warning for this month. */
  month: string;
}, words: DayWords = calendarWords): BudgetPace | null => {
  if (input.monthBudget <= 0) return null;
  if (input.spent >= input.monthBudget) return { tone: "bad", text: "бюджет месяца потрачен" };
  const exhaustOn = input.forecast?.exhaustOn ?? null;
  if (exhaustOn !== null && exhaustOn.slice(0, 7) === input.month) return { tone: "warning", text: `хватит ${words.until(exhaustOn)}` };
  if (input.plan <= 0) return null;
  const off = Math.round(((input.spent - input.plan) / input.plan) * 100);
  if (Math.abs(off) < ON_PLAN_PERCENT) return { tone: "good", text: "тратим по плану" };
  return off < 0 ? { tone: "neutral", text: `тратим на ${-off}% меньше плана` } : { tone: "warning", text: `тратим на ${off}% больше плана` };
};
