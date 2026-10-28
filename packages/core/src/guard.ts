import { allowedWeeklyTotal, budgetSignal } from "./budget";
import { daysBetween } from "./dates";
import { costPerLead } from "./types";
import type {
  Actor,
  Ad,
  Command,
  Direction,
  EffectivenessClass,
  Kopecks,
  LocalDate,
  PerformanceStats,
  UserDecision,
} from "./types";

export const LIMIT_STEP_FACTOR = 1.2;
export const LIMIT_INCREASE_COOLDOWN_DAYS = 3;
export const STRATEGY_CHANGE_COOLDOWN_DAYS = 7;
export const USER_DECISION_RESPECT_DAYS = 14;
export const MAX_ACTIVE_EXPERIMENTS = 2;

/** Current state at execution time — never the agent's turn snapshot. */
export interface GuardState {
  today: LocalDate;
  cso: Kopecks;
  monthBudget: Kopecks;
  spentMonth: Kopecks;
  directions: readonly Direction[];
  ads: readonly Ad[];
  adClasses: ReadonlyMap<string, EffectivenessClass>;
  directionStats14: ReadonlyMap<string, PerformanceStats>;
  userDecisions: readonly UserDecision[];
  strategyCatalog: readonly string[];
  minWeeklyLimit: Kopecks;
  activeExperiments: number;
}

export interface GuardReason {
  code: string;
  message: string;
}

export type Verdict =
  | { kind: "allow"; command: Command }
  | { kind: "clamp"; command: Command; reason: GuardReason }
  | { kind: "reject"; reason: GuardReason };

const reject = (code: string, message: string): Verdict => ({ kind: "reject", reason: { code, message } });

const rub = (kopecks: Kopecks): string => `${Math.floor(kopecks / 100).toLocaleString("ru-RU").replace(/ /g, " ")} ₽`;

const NOT_FOUND = (): Verdict => reject("OBJECT_NOT_FOUND", "объект не найден");

const respectsUserDecision = (state: GuardState, objectId: string, commandType: Command["type"]): boolean =>
  !state.userDecisions.some(
    (decision) =>
      decision.objectId === objectId &&
      decision.commandType === commandType &&
      daysBetween(decision.on, state.today) < USER_DECISION_RESPECT_DAYS,
  );

const activeLimitTotal = (state: GuardState, excludeDirectionId?: string): Kopecks =>
  state.directions
    .filter((d) => d.status === "active" && d.id !== excludeDirectionId)
    .reduce((sum, d) => sum + d.weeklyLimit, 0);

/** Budget part of the guard; applies to every actor. */
const budgetCheck = (state: GuardState, command: Command): Verdict => {
  const allowedTotal = allowedWeeklyTotal(state.spentMonth, state.monthBudget, state.today);
  const fit = (directionId: string, requested: Kopecks, build: (limit: Kopecks) => Command): Verdict => {
    const room = allowedTotal - activeLimitTotal(state, directionId);
    if (requested <= room) {
      return { kind: "allow", command: build(requested) };
    }
    if (room < state.minWeeklyLimit) {
      return reject("BUDGET_LIMIT_EXCEEDED", "остаток бюджета на этот месяц не позволяет увеличить расходы");
    }
    return {
      kind: "clamp",
      command: build(room),
      reason: { code: "BUDGET_CLAMP", message: `урезано до ${rub(room)} в неделю из-за остатка бюджета` },
    };
  };

  switch (command.type) {
    case "SetSpendLimit": {
      const direction = state.directions.find((d) => d.id === command.directionId);
      if (!direction) {
        return NOT_FOUND();
      }
      if (direction.status !== "active" || command.weeklyLimit <= direction.weeklyLimit) {
        return { kind: "allow", command };
      }
      return fit(direction.id, command.weeklyLimit, (limit) => ({ ...command, weeklyLimit: limit }));
    }
    case "ResumeDirection": {
      const direction = state.directions.find((d) => d.id === command.directionId);
      if (!direction) {
        return NOT_FOUND();
      }
      const requested = command.weeklyLimit ?? direction.weeklyLimit;
      return fit(direction.id, requested, (limit) => ({ ...command, weeklyLimit: limit }));
    }
    case "ResumeAll":
    case "ResumeAd":
    case "StartExperiment":
      return budgetSignal(state.spentMonth, state.monthBudget) === "stop"
        ? reject("BUDGET_EXHAUSTED", "бюджет на этот месяц почти израсходован")
        : { kind: "allow", command };
    default:
      return { kind: "allow", command };
  }
};

/** Optimization guardrails for automated actors (agent and safety net). */
const optimizationCheck = (state: GuardState, command: Command, actor: Actor): Verdict => {
  switch (command.type) {
    case "SetSpendLimit": {
      const direction = state.directions.find((d) => d.id === command.directionId);
      if (!direction) {
        return NOT_FOUND();
      }
      if (command.weeklyLimit <= direction.weeklyLimit) {
        return { kind: "allow", command };
      }
      if (!respectsUserDecision(state, direction.id, "SetSpendLimit")) {
        return reject("USER_DECISION", "пользователь отменил это действие меньше 14 дней назад");
      }
      if (
        direction.lastLimitIncreaseOn !== null &&
        daysBetween(direction.lastLimitIncreaseOn, state.today) < LIMIT_INCREASE_COOLDOWN_DAYS
      ) {
        return reject("LIMIT_INCREASE_COOLDOWN", "лимит этого направления можно повышать не чаще раза в 3 дня");
      }
      const cpl = costPerLead(state.directionStats14.get(direction.id) ?? { impressions: 0, clicks: 0, leads: 0, spend: 0 });
      if (cpl === null || cpl > state.cso) {
        return reject("SCALE_ABOVE_CSO", "нельзя повышать лимит направлению, где обращение дороже цели");
      }
      const maxStep = Math.floor(direction.weeklyLimit * LIMIT_STEP_FACTOR);
      if (command.weeklyLimit > maxStep) {
        return {
          kind: "clamp",
          command: { ...command, weeklyLimit: maxStep },
          reason: { code: "LIMIT_STEP_CLAMP", message: "урезано: не больше +20% за шаг" },
        };
      }
      return { kind: "allow", command };
    }
    case "SetStrategy": {
      const direction = state.directions.find((d) => d.id === command.directionId);
      if (!direction) {
        return NOT_FOUND();
      }
      if (!state.strategyCatalog.includes(command.strategyId)) {
        return reject("STRATEGY_NOT_IN_CATALOG", "такой стратегии нет в каталоге площадки");
      }
      if (
        direction.lastStrategyChangeOn !== null &&
        daysBetween(direction.lastStrategyChangeOn, state.today) < STRATEGY_CHANGE_COOLDOWN_DAYS
      ) {
        return reject("STRATEGY_COOLDOWN", "стратегию этого направления можно менять не чаще раза в 7 дней");
      }
      return { kind: "allow", command };
    }
    case "PauseAd": {
      const ad = state.ads.find((a) => a.id === command.adId);
      if (!ad) {
        return NOT_FOUND();
      }
      if (!respectsUserDecision(state, ad.id, "PauseAd")) {
        return reject("USER_DECISION", "пользователь отменил это действие меньше 14 дней назад");
      }
      if (state.adClasses.get(ad.id) === "learning" && command.dueToModeration !== true) {
        return reject("STILL_LEARNING", "по этому объявлению ещё собираем данные");
      }
      const otherActive = state.ads.filter((a) => a.directionId === ad.directionId && a.id !== ad.id && a.status === "active");
      const replacementOk =
        command.replacementAdId !== undefined &&
        state.ads.some((a) => a.id === command.replacementAdId && a.directionId === ad.directionId);
      if (otherActive.length === 0 && !replacementOk) {
        return reject("LAST_AD_NO_REPLACEMENT", "нельзя отключить последнее объявление направления без замены");
      }
      return { kind: "allow", command };
    }
    case "PauseDirection": {
      const direction = state.directions.find((d) => d.id === command.directionId);
      if (!direction) {
        return NOT_FOUND();
      }
      return respectsUserDecision(state, direction.id, "PauseDirection")
        ? { kind: "allow", command }
        : reject("USER_DECISION", "пользователь отменил это действие меньше 14 дней назад");
    }
    case "ResumeAd":
    case "ResumeDirection": {
      const id = command.type === "ResumeAd" ? command.adId : command.directionId;
      const exists =
        command.type === "ResumeAd" ? state.ads.some((a) => a.id === id) : state.directions.some((d) => d.id === id);
      if (!exists) {
        return NOT_FOUND();
      }
      // An automated actor must not revive what the classification marks as ineffective.
      const ineffective =
        command.type === "ResumeAd"
          ? state.adClasses.get(id) === "ineffective"
          : costPerLead(state.directionStats14.get(id) ?? { impressions: 0, clicks: 0, leads: 0, spend: 0 }) === null &&
            (state.directionStats14.get(id)?.spend ?? 0) >= 3 * state.cso;
      return ineffective ? reject("RESUME_INEFFECTIVE", "нельзя включать рекламу, которая не приводит клиентов") : { kind: "allow", command };
    }
    case "StartExperiment": {
      if (!state.ads.some((a) => a.id === command.adId && a.directionId === command.directionId)) {
        return NOT_FOUND();
      }
      return state.activeExperiments >= MAX_ACTIVE_EXPERIMENTS
        ? reject("EXPERIMENT_SLOTS_FULL", "уже идут 2 эксперимента")
        : { kind: "allow", command };
    }
    case "UpdateSchedule":
    case "UpdateGeo":
      return state.directions.some((d) => d.id === command.directionId) ? { kind: "allow", command } : NOT_FOUND();
    case "UpdateAdText":
      return state.ads.some((a) => a.id === command.adId) ? { kind: "allow", command } : NOT_FOUND();
    case "UpdateMiniSite":
    case "PublishMiniSite":
      return reject("NOT_ALLOWED_FOR_AUTOMATION", "мини-сайт меняет только владелец бизнеса");
    case "FinishExperiment":
      return actor === "agent"
        ? reject("EXPERIMENT_VERDICT_LOCKED", "итог эксперимента определяет расчёт, агент не может его менять")
        : { kind: "allow", command };
    case "PauseAll":
    case "ResumeAll":
      return reject("NOT_ALLOWED_FOR_AUTOMATION", "это действие доступно только пользователю и защите бюджета");
  }
};

/**
 * Deterministic guard: same state and command always give the same verdict.
 * Automated actors pass optimization guardrails first; every actor passes the budget check.
 */
export const guard = (state: GuardState, command: Command, actor: Actor): Verdict => {
  if (actor === "budget_guard") {
    return { kind: "allow", command };
  }
  let current: Command = command;
  let clampReason: GuardReason | null = null;
  if (actor === "agent" || actor === "safety_net") {
    const verdict = optimizationCheck(state, current, actor);
    if (verdict.kind === "reject") {
      return verdict;
    }
    if (verdict.kind === "clamp") {
      clampReason = verdict.reason;
    }
    current = verdict.command;
  }
  const budgetVerdict = budgetCheck(state, current);
  if (budgetVerdict.kind === "reject") {
    return budgetVerdict;
  }
  if (budgetVerdict.kind === "clamp") {
    return budgetVerdict;
  }
  return clampReason === null ? budgetVerdict : { kind: "clamp", command: budgetVerdict.command, reason: clampReason };
};
