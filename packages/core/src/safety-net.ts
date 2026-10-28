import { daysBetween } from "./dates";
import { LIMIT_INCREASE_COOLDOWN_DAYS, LIMIT_STEP_FACTOR, MAX_ACTIVE_EXPERIMENTS, USER_DECISION_RESPECT_DAYS } from "./guard";
import type { GuardState } from "./guard";
import type { Command, EffectivenessClass, Kopecks, LocalDate } from "./types";

export const SAFETY_NET_DELAY_HOURS = 24;
export const SCALE_UTILIZATION = 0.9;
export const EXPERIMENT_DELAY_DAYS = 7;

export interface SafetyNetInput {
  state: GuardState;
  /** Classes from the daily evaluation that happened at least 24 hours ago. */
  directionClasses: ReadonlyMap<string, EffectivenessClass>;
  /** Objects the agent paused or changed since that evaluation. */
  touchedByAgent: ReadonlySet<string>;
  spendLast7Days: ReadonlyMap<string, Kopecks>;
  leads14: ReadonlyMap<string, number>;
  /** First day each ad was classified as borderline in the current streak. */
  borderlineSince: ReadonlyMap<string, LocalDate>;
  adsInExperiments: ReadonlySet<string>;
}

export type SafetyAction =
  | { kind: "command"; command: Command; reasonCode: string }
  | { kind: "request_replacement"; adId: string; directionId: string; reasonCode: string };

const userDecided = (state: GuardState, objectId: string): boolean =>
  state.userDecisions.some((d) => d.objectId === objectId && daysBetween(d.on, state.today) < USER_DECISION_RESPECT_DAYS);

/** Does what the agent should have done but did not (optimization-engine spec, safety-net requirements). */
export const safetyNet = (input: SafetyNetInput): SafetyAction[] => {
  const { state } = input;
  const actions: SafetyAction[] = [];
  const pausedNow = new Set<string>();

  for (const direction of state.directions.filter((d) => d.status === "active")) {
    const activeAds = state.ads.filter((a) => a.directionId === direction.id && a.status === "active");
    const badAds = activeAds.filter(
      (a) => state.adClasses.get(a.id) === "ineffective" && !input.touchedByAgent.has(a.id) && !userDecided(state, a.id),
    );
    const directionBad =
      input.directionClasses.get(direction.id) === "ineffective" &&
      !input.touchedByAgent.has(direction.id) &&
      !userDecided(state, direction.id);
    if (directionBad || (activeAds.length > 0 && badAds.length === activeAds.length && !userDecided(state, direction.id))) {
      actions.push({ kind: "command", command: { type: "PauseDirection", directionId: direction.id }, reasonCode: "SAFETY_PAUSE_DIRECTION" });
      pausedNow.add(direction.id);
      continue;
    }
    for (const ad of badAds) {
      if (activeAds.length === 1) {
        actions.push({ kind: "request_replacement", adId: ad.id, directionId: direction.id, reasonCode: "SAFETY_REPLACE_LAST_AD" });
      } else {
        actions.push({ kind: "command", command: { type: "PauseAd", adId: ad.id }, reasonCode: "SAFETY_PAUSE_AD" });
      }
    }
  }

  const freed = state.directions.filter((d) => pausedNow.has(d.id)).reduce((sum, d) => sum + d.weeklyLimit, 0);
  const effective = state.directions.filter(
    (d) =>
      d.status === "active" &&
      !pausedNow.has(d.id) &&
      input.directionClasses.get(d.id) === "effective" &&
      !input.touchedByAgent.has(d.id) &&
      (d.lastLimitIncreaseOn === null || daysBetween(d.lastLimitIncreaseOn, state.today) >= LIMIT_INCREASE_COOLDOWN_DAYS),
  );
  const totalLeads = effective.reduce((sum, d) => sum + (input.leads14.get(d.id) ?? 0), 0);
  for (const direction of effective) {
    const cappedByLimit = (input.spendLast7Days.get(direction.id) ?? 0) >= direction.weeklyLimit * SCALE_UTILIZATION;
    const share = totalLeads === 0 ? 0 : Math.floor((freed * (input.leads14.get(direction.id) ?? 0)) / totalLeads);
    const maxStep = Math.floor(direction.weeklyLimit * LIMIT_STEP_FACTOR);
    const target = Math.min(maxStep, cappedByLimit ? maxStep : direction.weeklyLimit + share);
    if (target > direction.weeklyLimit) {
      actions.push({
        kind: "command",
        command: { type: "SetSpendLimit", directionId: direction.id, weeklyLimit: target },
        reasonCode: cappedByLimit ? "SAFETY_SCALE_EFFECTIVE" : "SAFETY_REDISTRIBUTE_FREED",
      });
    }
  }

  let slots = MAX_ACTIVE_EXPERIMENTS - state.activeExperiments;
  for (const ad of state.ads) {
    if (slots <= 0) {
      break;
    }
    const since = input.borderlineSince.get(ad.id);
    if (
      ad.status === "active" &&
      !pausedNow.has(ad.directionId) &&
      state.adClasses.get(ad.id) === "borderline" &&
      since !== undefined &&
      daysBetween(since, state.today) >= EXPERIMENT_DELAY_DAYS &&
      !input.adsInExperiments.has(ad.id) &&
      !input.touchedByAgent.has(ad.id)
    ) {
      actions.push({
        kind: "command",
        command: { type: "StartExperiment", directionId: ad.directionId, adId: ad.id, hypothesis: "" },
        reasonCode: "SAFETY_START_EXPERIMENT",
      });
      slots--;
    }
  }
  return actions;
};
