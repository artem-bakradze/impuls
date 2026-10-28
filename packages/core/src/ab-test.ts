import { daysBetween } from "./dates";
import { createRng, sampleBeta, seedFromString } from "./rng";
import type { LocalDate, PerformanceStats } from "./types";

export const AB_MIN_DAYS = 7;
export const AB_MAX_DAYS = 21;
export const AB_MIN_CLICKS = 100;
export const AB_WIN_PROBABILITY = 0.9;
export const AB_EARLY_STOP_PROBABILITY = 0.97;
const SAMPLES = 10_000;

export type ExperimentOutcome =
  | { status: "running"; probabilityVariantBetter: number }
  | { status: "variant_wins"; probabilityVariantBetter: number }
  | { status: "control_wins_early"; probabilityVariantBetter: number }
  | { status: "no_difference"; keep: "control" | "variant"; probabilityVariantBetter: number };

/**
 * P(variant has a lower cost per lead than control). Conversion click → lead is Beta(1 + leads, 1 + clicks − leads);
 * cost per lead = average click cost / conversion. Seeded by the experiment ID, so the verdict is deterministic.
 */
export const probabilityVariantBetter = (
  control: PerformanceStats,
  variant: PerformanceStats,
  experimentId: string,
): number => {
  const rng = createRng(seedFromString(experimentId));
  const cpcControl = control.clicks === 0 ? 0 : control.spend / control.clicks;
  const cpcVariant = variant.clicks === 0 ? 0 : variant.spend / variant.clicks;
  let better = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const crControl = sampleBeta(rng, 1 + control.leads, 1 + Math.max(0, control.clicks - control.leads));
    const crVariant = sampleBeta(rng, 1 + variant.leads, 1 + Math.max(0, variant.clicks - variant.leads));
    if (cpcVariant / crVariant < cpcControl / crControl) {
      better++;
    }
  }
  return better / SAMPLES;
};

const observedCostPerLead = (stats: PerformanceStats): number =>
  stats.leads === 0 ? Number.POSITIVE_INFINITY : stats.spend / stats.leads;

/** Decision rule from the ab-testing spec. */
export const evaluateExperiment = (input: {
  experimentId: string;
  startedOn: LocalDate;
  today: LocalDate;
  control: PerformanceStats;
  variant: PerformanceStats;
}): ExperimentOutcome => {
  const days = daysBetween(input.startedOn, input.today);
  const p = probabilityVariantBetter(input.control, input.variant, input.experimentId);
  if (days < AB_MIN_DAYS) {
    return { status: "running", probabilityVariantBetter: p };
  }
  const enoughClicks = input.control.clicks >= AB_MIN_CLICKS && input.variant.clicks >= AB_MIN_CLICKS;
  if (enoughClicks && p >= AB_WIN_PROBABILITY) {
    return { status: "variant_wins", probabilityVariantBetter: p };
  }
  if (1 - p >= AB_EARLY_STOP_PROBABILITY) {
    return { status: "control_wins_early", probabilityVariantBetter: p };
  }
  if (days >= AB_MAX_DAYS) {
    const keep = observedCostPerLead(input.variant) < observedCostPerLead(input.control) ? "variant" : "control";
    return { status: "no_difference", keep, probabilityVariantBetter: p };
  }
  return { status: "running", probabilityVariantBetter: p };
};
