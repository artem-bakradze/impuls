import { costPerLead } from "./types";
import type { EffectivenessClass, Kopecks, PerformanceStats } from "./types";

export const LEARNING_MIN_DAYS = 7;

/**
 * Deterministic effectiveness class over a rolling 14-day window (optimization-engine spec).
 */
export const classify = (stats: PerformanceStats, ageDays: number, cso: Kopecks): EffectivenessClass => {
  if (ageDays < LEARNING_MIN_DAYS || stats.spend < 2 * cso) {
    return "learning";
  }
  const cpl = costPerLead(stats);
  if (stats.spend >= 3 * cso && (cpl === null || cpl >= 2 * cso)) {
    return "ineffective";
  }
  if (cpl !== null && stats.leads >= 3 && cpl <= 0.7 * cso) {
    return "effective";
  }
  return "borderline";
};
