import { addDays, daysBetween } from "./dates";
import { guard, LIMIT_INCREASE_COOLDOWN_DAYS, LIMIT_STEP_FACTOR } from "./guard";
import type { GuardState } from "./guard";
import { EXPERIMENT_DELAY_DAYS, SCALE_UTILIZATION } from "./safety-net";
import type { EffectivenessClass, Kopecks, LocalDate, PerformanceStats } from "./types";

/** A week differs sharply from the one before when a number moved by more than this share (ad-agent spec). */
export const SWING_SHARE = 0.5;
/** …and at least one of the two weeks had this many leads: below it a swing is noise. */
export const SWING_MIN_LEADS = 3;

export type TurnReasonKind =
  | "became_ineffective"
  | "no_longer_ineffective"
  | "classified"
  | "scale"
  | "borderline"
  | "swing"
  | "hypothesis_due";

export interface TurnReason {
  kind: TurnReasonKind;
  /** The finding's key: the same finding has the same key every day. */
  key: string;
  objectKind: "ad" | "direction" | "hypothesis";
  objectId: string;
}

export interface FindingsInput {
  state: GuardState;
  directionClasses: ReadonlyMap<string, EffectivenessClass>;
  /** First day each ad was classified as borderline in the current streak. */
  borderlineSince: ReadonlyMap<string, LocalDate>;
  adsInExperiments: ReadonlySet<string>;
  spendLast7Days: ReadonlyMap<string, Kopecks>;
  /** Per direction: the last 7 full days and the 7 days before them. */
  directionLast7: ReadonlyMap<string, PerformanceStats>;
  directionPrevious7: ReadonlyMap<string, PerformanceStats>;
  /** Open hypotheses whose check day has come. */
  hypothesesDue: readonly { id: string; checkOn: LocalDate }[];
}

const costPerLead = (s: PerformanceStats | undefined): number | null => (s && s.leads > 0 ? s.spend / s.leads : null);

const moved = (now: number, before: number): "up" | "down" | null => {
  if (before === 0) return now > 0 ? "up" : null;
  const share = (now - before) / before;
  return share > SWING_SHARE ? "up" : share < -SWING_SHARE ? "down" : null;
};

/**
 * What the daily evaluation found (ad-agent spec «Поводы для хода агента»), as stable keys: the same finding has the
 * same key every day it holds. Pure: the model takes no part in it.
 */
export const evaluationFindings = (input: FindingsInput): string[] => {
  const { state } = input;
  const findings: string[] = [];
  const activeDirections = state.directions.filter((d) => d.status === "active");
  const activeDirectionIds = new Set(activeDirections.map((d) => d.id));
  const activeAds = state.ads.filter((a) => a.status === "active" && activeDirectionIds.has(a.directionId));

  for (const ad of activeAds) {
    const cls = state.adClasses.get(ad.id);
    if (cls === undefined) continue;
    if (cls !== "learning") findings.push(`classified:ad:${ad.id}`);
    if (cls === "ineffective") findings.push(`ineffective:ad:${ad.id}`);
    const since = input.borderlineSince.get(ad.id);
    // A day before the safety net may start a check itself, so the agent can start one with its own hypothesis first.
    if (cls === "borderline" && since !== undefined && !input.adsInExperiments.has(ad.id) && daysBetween(since, state.today) >= EXPERIMENT_DELAY_DAYS - 1) {
      findings.push(`borderline:ad:${ad.id}`);
    }
  }

  for (const direction of activeDirections) {
    const cls = input.directionClasses.get(direction.id);
    if (cls !== undefined && cls !== "learning") findings.push(`classified:direction:${direction.id}`);
    if (cls === "ineffective") findings.push(`ineffective:direction:${direction.id}`);
    if (
      cls === "effective" &&
      (input.spendLast7Days.get(direction.id) ?? 0) >= direction.weeklyLimit * SCALE_UTILIZATION &&
      (direction.lastLimitIncreaseOn === null || daysBetween(direction.lastLimitIncreaseOn, state.today) >= LIMIT_INCREASE_COOLDOWN_DAYS) &&
      // The same guards as the safety net's raise, including «not for a few rubles».
      guard(state, { type: "SetSpendLimit", directionId: direction.id, weeklyLimit: Math.floor(direction.weeklyLimit * LIMIT_STEP_FACTOR) }, "safety_net").kind !== "reject"
    ) {
      findings.push(`scale:direction:${direction.id}`);
    }
    const last = input.directionLast7.get(direction.id);
    const previous = input.directionPrevious7.get(direction.id);
    // Both weeks must be after the launch: a week before it has no leads and would look like a sharp rise.
    const twoWeeksOld = direction.createdOn <= addDays(state.today, -14);
    if (twoWeeksOld && last && previous && Math.max(last.leads, previous.leads) >= SWING_MIN_LEADS) {
      const leads = moved(last.leads, previous.leads);
      if (leads) findings.push(`swing:direction:${direction.id}:leads:${leads}`);
      const cplNow = costPerLead(last);
      const cplBefore = costPerLead(previous);
      const cpl = cplNow !== null && cplBefore !== null ? moved(cplNow, cplBefore) : null;
      if (cpl) findings.push(`swing:direction:${direction.id}:cpl:${cpl}`);
    }
  }

  // Keyed by the check day, so a hypothesis left open gives one reason, not one every day.
  for (const h of input.hypothesesDue) findings.push(`hypothesis:${h.id}:${h.checkOn}`);
  return findings;
};

const reasonOf = (key: string, kind: TurnReasonKind): TurnReason => {
  const [prefix, objectKind, id] = key.split(":");
  if (prefix === "hypothesis") return { kind, key, objectKind: "hypothesis", objectId: objectKind ?? "" };
  return { kind, key, objectKind: objectKind === "ad" ? "ad" : "direction", objectId: id ?? "" };
};

const KINDS: Record<string, TurnReasonKind> = {
  ineffective: "became_ineffective",
  classified: "classified",
  scale: "scale",
  borderline: "borderline",
  swing: "swing",
  hypothesis: "hypothesis_due",
};

/**
 * Reasons for the agent's turn: findings the last completed turn did not see, or that disappeared since the previous
 * evaluation and came back; and objects the last turn saw as ineffective that are no longer so.
 */
export const turnReasons = (findings: readonly string[], previousFindings: ReadonlySet<string>, seenByLastTurn: ReadonlySet<string>): TurnReason[] => {
  const now = new Set(findings);
  const reasons: TurnReason[] = [];
  for (const key of findings) {
    if (!seenByLastTurn.has(key) || !previousFindings.has(key)) {
      const kind = KINDS[key.split(":")[0] ?? ""];
      if (kind) reasons.push(reasonOf(key, kind));
    }
  }
  for (const key of seenByLastTurn) {
    if (key.startsWith("ineffective:") && !now.has(key)) reasons.push(reasonOf(key, "no_longer_ineffective"));
  }
  return reasons;
};
