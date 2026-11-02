import type { Kopecks } from "./types";

/** Where the target cost per lead (ЦСО) comes from. */
export type CsoSource = { kind: "user"; goal: Kopecks } | { kind: "auto"; reference: Kopecks };

export const AUTO_CSO_MIN_LEADS = 20;
export const AUTO_CSO_CAP_FACTOR = 1.5;

/** Resolves ЦСО. A user goal is never changed automatically; only the "pick for me" mode recalculates. */
export const resolveCso = (
  source: CsoSource,
  last30Days: { leads: number; medianCostPerLead: Kopecks | null },
): Kopecks => {
  if (source.kind === "user") {
    return source.goal;
  }
  if (last30Days.leads < AUTO_CSO_MIN_LEADS || last30Days.medianCostPerLead === null) {
    return source.reference;
  }
  return Math.min(last30Days.medianCostPerLead, Math.round(source.reference * AUTO_CSO_CAP_FACTOR));
};

export type GoalAdvice = { kind: "reachable" } | { kind: "unreachable"; medianCostPerLead: Kopecks; suggestedGoal: Kopecks };

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + upper) / 2 : upper;
};

/**
 * Goal is unreachable when every direction past learning costs more than ЦСО per lead over 14 days.
 * The suggestion is the median actual cost, rounded to 50 ₽; up, when the nearest 50 ₽ would not be a raise.
 */
export const goalAdvice = (costPerLeadByDirection: readonly (Kopecks | null)[], cso: Kopecks): GoalAdvice => {
  // A direction past learning without any lead (null) is not within the goal either.
  const known = costPerLeadByDirection.filter((value): value is Kopecks => value !== null);
  if (known.length === 0 || known.some((value) => value <= cso)) {
    return { kind: "reachable" };
  }
  const med = median(known);
  const nearest = Math.round(med / 5000) * 5000;
  return { kind: "unreachable", medianCostPerLead: Math.round(med), suggestedGoal: nearest > cso ? nearest : Math.ceil(med / 5000) * 5000 };
};

/** True when the forecast spend for the month is below 70% of the budget because of the goal. */
export const isUnderspending = (forecastMonthSpend: Kopecks, budget: Kopecks): boolean =>
  budget > 0 && forecastMonthSpend < budget * 0.7;
