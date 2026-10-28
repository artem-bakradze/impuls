import { daysBetween, daysInMonth, endOfMonth, monthKey, weeksLeftInMonth } from "./dates";
import type { Kopecks, LocalDate } from "./types";

/** Share of the month budget that platform-side limits may commit to (design decision 6). */
export const PLATFORM_LIMIT_SHARE = 0.9;
export const NOTIFY_THRESHOLD = 0.8;
export const STOP_THRESHOLD = 0.95;

/**
 * Budget ceiling for the month that contains `today`.
 * In the launch month the ceiling is prorated by the remaining days and rounded down to whole rubles.
 */
export const monthBudget = (monthlyBudgetRub: number, launchedOn: LocalDate, today: LocalDate): Kopecks => {
  if (!Number.isInteger(monthlyBudgetRub) || monthlyBudgetRub < 0) {
    throw new Error(`Monthly budget must be a non-negative integer of rubles, got ${monthlyBudgetRub}`);
  }
  if (monthKey(today) < monthKey(launchedOn)) {
    return 0;
  }
  if (monthKey(today) > monthKey(launchedOn)) {
    return monthlyBudgetRub * 100;
  }
  const remainingDays = daysBetween(launchedOn, endOfMonth(launchedOn)) + 1;
  return Math.floor((monthlyBudgetRub * remainingDays) / daysInMonth(launchedOn)) * 100;
};

/** Upper bound of what the platform may still spend this month under the given weekly limits. */
export const maxFutureSpend = (activeWeeklyLimits: readonly Kopecks[], today: LocalDate): Kopecks =>
  activeWeeklyLimits.reduce((sum, limit) => sum + limit, 0) * weeksLeftInMonth(today);

/** Largest total of active weekly limits that keeps spent + future spend within the platform share. */
export const allowedWeeklyTotal = (spentMonth: Kopecks, budget: Kopecks, today: LocalDate): Kopecks => {
  const headroom = Math.floor(budget * PLATFORM_LIMIT_SHARE) - spentMonth;
  return headroom <= 0 ? 0 : Math.floor(headroom / weeksLeftInMonth(today));
};

export interface LimitInput {
  directionId: string;
  weeklyLimit: Kopecks;
  /** Higher is better; used to decide which directions stay active when money runs short. */
  rank: number;
}

export interface FittedLimits {
  limits: Map<string, Kopecks>;
  paused: string[];
}

/**
 * Scales limits down proportionally until they fit the allowed total.
 * If a scaled limit falls below the platform minimum, the lowest-ranked directions are paused.
 */
export const fitLimits = (
  inputs: readonly LimitInput[],
  allowedTotal: Kopecks,
  minWeeklyLimit: Kopecks,
): FittedLimits => {
  const active = [...inputs].sort((a, b) => b.rank - a.rank);
  const paused: string[] = [];
  for (;;) {
    const total = active.reduce((sum, item) => sum + item.weeklyLimit, 0);
    if (total <= allowedTotal) {
      return { limits: new Map(active.map((item) => [item.directionId, item.weeklyLimit])), paused };
    }
    const factor = allowedTotal / total;
    const scaled = active.map((item) => ({ ...item, weeklyLimit: Math.floor(item.weeklyLimit * factor) }));
    if (scaled.every((item) => item.weeklyLimit >= minWeeklyLimit)) {
      return { limits: new Map(scaled.map((item) => [item.directionId, item.weeklyLimit])), paused };
    }
    const dropped = active.pop();
    if (!dropped) {
      return { limits: new Map(), paused };
    }
    paused.push(dropped.directionId);
  }
};

export type BudgetSignal = "ok" | "notify" | "stop";

export const budgetSignal = (spentMonth: Kopecks, budget: Kopecks): BudgetSignal => {
  if (budget === 0 || spentMonth >= budget * STOP_THRESHOLD) {
    return "stop";
  }
  return spentMonth >= budget * NOTIFY_THRESHOLD ? "notify" : "ok";
};
