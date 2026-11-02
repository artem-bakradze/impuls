import { allowedWeeklyTotal, budgetSignal } from "./budget";
import { validateAdText } from "./creatives";
import { daysBetween } from "./dates";
import { negativePhraseLengthIssue, negativeTotalLength, phraseMatches, phraseWords, segmentVerdict } from "./segments";
import type { SegmentStats } from "./segments";
import { costPerLead } from "./types";
import type {
  Actor,
  AdjustableDevice,
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
/** An automated raise the budget leaves smaller than this share of the limit is not made (optimization-engine spec). */
export const MIN_AUTOMATED_RAISE_SHARE = 0.05;
export const LIMIT_INCREASE_COOLDOWN_DAYS = 3;
export const STRATEGY_CHANGE_COOLDOWN_DAYS = 7;
export const USER_DECISION_RESPECT_DAYS = 14;
export const MAX_ACTIVE_EXPERIMENTS = 1;
/** Negative phrases the agent may add to one direction a day (optimization-engine spec «Ограничители минус-фраз»). */
export const MAX_NEGATIVE_PER_DAY = 10;
/** Bid adjustments of automated actors: the range, the step and how often (optimization-engine spec). */
export const DEVICE_ADJUSTMENT_RANGE = 50;
export const DEVICE_ADJUSTMENT_STEP = 25;
export const DEVICE_ADJUSTMENT_COOLDOWN_DAYS = 7;

/** What the analyst levers of a direction are checked against, at execution time (add-agent-analyst-stage1). */
export interface DirectionAnalystState {
  /** The direction's own key phrases: a negative phrase must not switch them off. */
  keywords: readonly string[];
  negativeKeywords: readonly string[];
  deviceAdjustments: Readonly<Record<AdjustableDevice, number>>;
  deviceAdjustedOn: Readonly<Record<AdjustableDevice, LocalDate | null>>;
  /** Negative phrases the agent added to this direction today. */
  negativeAddedToday: number;
  /** Fresh breakdowns of the last 14 days. */
  queries: readonly SegmentStats[];
  devices: readonly SegmentStats[];
}

/** The user decision key of one negative phrase or one device of a direction. */
export const analystDecisionKey = (directionId: string, item: string): string => `${directionId}|${item.toLowerCase()}`;

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
  /** Strategies that pay for leads and need a Metrica goal (platform capability `requiresLeadGoal`). */
  leadGoalStrategies: readonly string[];
  /** Whether the business has a Metrica goal that counts leads. */
  hasLeadGoal: boolean;
  minWeeklyLimit: Kopecks;
  activeExperiments: number;
  /** Analyst state of the directions an analyst command concerns; loaded only for such commands. */
  analyst?: ReadonlyMap<string, DirectionAnalystState>;
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
      const verdict = fit(direction.id, command.weeklyLimit, (limit) => ({ ...command, weeklyLimit: limit }));
      // An increase clamped to the current limit (or below) changes nothing; logging it would show a decision that
      // did not happen and a rollback with nothing to undo.
      if (verdict.kind === "clamp" && verdict.command.type === "SetSpendLimit" && verdict.command.weeklyLimit <= direction.weeklyLimit) {
        return reject("BUDGET_LIMIT_EXCEEDED", "остаток бюджета на этот месяц не позволяет увеличить расходы");
      }
      return verdict;
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

/** Stats of computers with tablets: a computer adjustment covers both. */
const deviceStats = (analyst: DirectionAnalystState, device: AdjustableDevice): SegmentStats => {
  const rows = analyst.devices.filter((d) => (device === "mobile" ? d.segment === "mobile" : d.segment === "desktop" || d.segment === "tablet"));
  return rows.reduce((sum, r) => ({ segment: device, impressions: sum.impressions + r.impressions, clicks: sum.clicks + r.clicks, leads: sum.leads + r.leads, spend: sum.spend + r.spend }), {
    segment: device,
    impressions: 0,
    clicks: 0,
    leads: 0,
    spend: 0,
  });
};

/** Optimization guardrails of the analyst levers (optimization-engine spec «Ограничители минус-фраз», «…корректировок»). */
const analystCheck = (state: GuardState, command: Extract<Command, { type: "AddNegativeKeywords" | "RemoveNegativeKeywords" | "SetDeviceAdjustment" }>): Verdict => {
  if (!state.directions.some((d) => d.id === command.directionId)) {
    return NOT_FOUND();
  }
  if (command.type === "RemoveNegativeKeywords") {
    return reject("NOT_ALLOWED_FOR_AUTOMATION", "минус-фразы убирает только владелец");
  }
  const analyst = state.analyst?.get(command.directionId);
  if (!analyst) {
    return reject("NO_SEGMENT_DATA", "по этой рекламе нет данных разреза");
  }
  if (command.type === "AddNegativeKeywords") {
    const existing = new Set(analyst.negativeKeywords.map((p) => phraseWords(p).join(" ")));
    const phrases = [...new Set(command.phrases.map((p) => phraseWords(p).join(" ")))].filter((p) => p !== "" && !existing.has(p));
    if (phrases.length === 0) {
      return reject("NEGATIVE_EXISTS", "эти минус-фразы уже есть");
    }
    if (analyst.negativeAddedToday + phrases.length > MAX_NEGATIVE_PER_DAY) {
      return reject("NEGATIVE_DAILY_LIMIT", "минус-фраз на сегодня достаточно, вернёмся к ним завтра");
    }
    for (const phrase of phrases) {
      const lengthIssue = negativePhraseLengthIssue(phrase);
      if (lengthIssue !== null) {
        return reject("NEGATIVE_INVALID", lengthIssue);
      }
      if (analyst.keywords.some((keyword) => phraseMatches(phrase, keyword))) {
        return reject("NEGATIVE_BLOCKS_KEYWORDS", "эта минус-фраза отключит показы по вашим основным запросам");
      }
      if (!respectsUserDecision(state, analystDecisionKey(command.directionId, phrase), "AddNegativeKeywords")) {
        return reject("USER_DECISION", "владелец убрал эту минус-фразу меньше 14 дней назад");
      }
      const matched = analyst.queries.filter((q) => phraseMatches(phrase, q.segment));
      if (matched.length === 0) {
        return reject("NEGATIVE_NO_QUERY", "такого поискового запроса у рекламы нет");
      }
      if (matched.some((q) => segmentVerdict(q, state.cso) === "within")) {
        return reject("NEGATIVE_GOOD_QUERY", "этот запрос приводит обращения в цели");
      }
      if (!matched.some((q) => segmentVerdict(q, state.cso) === "above")) {
        return reject("NEGATIVE_LEARNING", "по этому запросу ещё мало данных");
      }
    }
    if (negativeTotalLength([...analyst.negativeKeywords, ...phrases]) > 20_000) {
      return reject("NEGATIVE_TOO_LONG", "у рекламы слишком много минус-фраз");
    }
    return { kind: "allow", command: { ...command, phrases } };
  }
  const current = analyst.deviceAdjustments[command.device];
  if (segmentVerdict(deviceStats(analyst, command.device), state.cso) === "learning") {
    return reject("DEVICE_LEARNING", "по этому устройству ещё мало данных");
  }
  const changedOn = analyst.deviceAdjustedOn[command.device];
  if (changedOn !== null && daysBetween(changedOn, state.today) < DEVICE_ADJUSTMENT_COOLDOWN_DAYS) {
    return reject("DEVICE_COOLDOWN", "корректировку этого устройства можно менять не чаще раза в 7 дней");
  }
  if (!respectsUserDecision(state, analystDecisionKey(command.directionId, command.device), "SetDeviceAdjustment")) {
    return reject("USER_DECISION", "владелец вернул эту корректировку меньше 14 дней назад");
  }
  let percent = Math.round(command.percent);
  let reason: GuardReason | null = null;
  if (Math.abs(percent) > DEVICE_ADJUSTMENT_RANGE) {
    percent = Math.sign(percent) * DEVICE_ADJUSTMENT_RANGE;
    reason = { code: "DEVICE_RANGE_CLAMP", message: `урезано до ${percent > 0 ? "+" : "−"}${DEVICE_ADJUSTMENT_RANGE}%: сильнее менять цену перехода нельзя` };
  }
  if (Math.abs(percent - current) > DEVICE_ADJUSTMENT_STEP) {
    percent = current + Math.sign(percent - current) * DEVICE_ADJUSTMENT_STEP;
    reason = { code: "DEVICE_STEP_CLAMP", message: `урезано: не больше ${DEVICE_ADJUSTMENT_STEP} пунктов за шаг` };
  }
  if (percent === current) {
    return reject("DEVICE_NO_CHANGE", "такая корректировка уже стоит");
  }
  const clamped: Command = { ...command, percent };
  return reason === null ? { kind: "allow", command: clamped } : { kind: "clamp", command: clamped, reason };
};

/** Optimization guardrails for automated actors (agent and safety net). */
const optimizationCheck = (state: GuardState, command: Command, actor: Actor): Verdict => {
  switch (command.type) {
    case "AddNegativeKeywords":
    case "RemoveNegativeKeywords":
    case "SetDeviceAdjustment":
      return analystCheck(state, command);
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
      if (state.leadGoalStrategies.includes(command.strategyId) && !state.hasLeadGoal) {
        return reject("NO_LEAD_GOAL", "нет цели для подсчёта обращений");
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
      if (command.variant === undefined) {
        return reject("EXPERIMENT_NO_VARIANT", "нет варианта объявления для проверки");
      }
      return state.activeExperiments >= MAX_ACTIVE_EXPERIMENTS
        ? reject("EXPERIMENT_SLOTS_FULL", "уже идёт проверка — новая начнётся после её завершения")
        : { kind: "allow", command };
    }
    case "UpdateSchedule":
    case "UpdateGeo":
      return state.directions.some((d) => d.id === command.directionId) ? { kind: "allow", command } : NOT_FOUND();
    case "UpdateAdText": {
      if (!state.ads.some((a) => a.id === command.adId)) {
        return NOT_FOUND();
      }
      const issues = validateAdText({ title: command.title, text: command.text });
      return issues.length > 0 ? reject("AD_TEXT_INVALID", issues.map((i) => i.message).join("; ")) : { kind: "allow", command };
    }
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
    case "SetGoal":
      return reject("NOT_ALLOWED_FOR_AUTOMATION", "цель по цене обращения меняет только владелец бизнеса");
    case "UpdateCard":
      return reject("NOT_ALLOWED_FOR_AUTOMATION", "описание бизнеса меняет только владелец бизнеса");
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
    // «Выделил больше денег» for a few rubles misleads the owner: such an automated raise is not made at all.
    const clamped = budgetVerdict.command;
    const direction = clamped.type === "SetSpendLimit" ? state.directions.find((d) => d.id === clamped.directionId) : undefined;
    if (
      (actor === "agent" || actor === "safety_net") &&
      clamped.type === "SetSpendLimit" &&
      direction !== undefined &&
      clamped.weeklyLimit - direction.weeklyLimit < direction.weeklyLimit * MIN_AUTOMATED_RAISE_SHARE
    ) {
      return reject("BUDGET_LIMIT_EXCEEDED", "остаток бюджета на этот месяц позволяет добавить совсем немного");
    }
    return budgetVerdict;
  }
  return clampReason === null ? budgetVerdict : { kind: "clamp", command: budgetVerdict.command, reason: clampReason };
};
