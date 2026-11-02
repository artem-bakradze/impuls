import { describe, expect, it } from "vitest";
import { evaluateExperiment } from "./ab-test";
import { classify } from "./classify";
import { goalAdvice, resolveCso } from "./cso";
import { validateExplanation } from "./explanations";
import { guard } from "./guard";
import type { GuardState } from "./guard";
import { safetyNet } from "./safety-net";
import type { Ad, Direction, PerformanceStats } from "./types";
import { rubles } from "./types";

const stats = (spendRub: number, leads: number, clicks = 100): PerformanceStats => ({
  impressions: clicks * 20,
  clicks,
  leads,
  spend: rubles(spendRub),
});

const direction = (overrides: Partial<Direction> = {}): Direction => ({
  id: "d1",
  businessId: "b1",
  name: "Маникюр — Поиск",
  channel: "search",
  status: "active",
  weeklyLimit: rubles(2_800),
  strategyId: "WB_MAXIMUM_CLICKS",
  createdOn: "2026-09-01",
  lastLimitIncreaseOn: null,
  lastStrategyChangeOn: null,
  ...overrides,
});

const ad = (id: string, overrides: Partial<Ad> = {}): Ad => ({
  id,
  directionId: "d1",
  status: "active",
  title: "Маникюр у метро",
  text: "Маникюр с покрытием",
  createdOn: "2026-09-01",
  ...overrides,
});

const baseState = (overrides: Partial<GuardState> = {}): GuardState => ({
  today: "2026-10-12",
  cso: rubles(800),
  monthBudget: rubles(30_000),
  spentMonth: rubles(5_000),
  directions: [direction()],
  ads: [ad("a1"), ad("a2")],
  adClasses: new Map([
    ["a1", "effective"],
    ["a2", "effective"],
  ]),
  directionStats14: new Map([["d1", stats(5_200, 10)]]),
  userDecisions: [],
  strategyCatalog: ["WB_MAXIMUM_CLICKS", "AVERAGE_CPA"],
  leadGoalStrategies: ["AVERAGE_CPA"],
  hasLeadGoal: true,
  minWeeklyLimit: rubles(300),
  activeExperiments: 0,
  ...overrides,
});

describe("ЦСО", () => {
  it("never changes a user goal", () => {
    expect(resolveCso({ kind: "user", goal: rubles(300) }, { leads: 50, medianCostPerLead: rubles(450) })).toBe(rubles(300));
  });

  it("recalculates in auto mode after 20 leads, capped at ×1.5", () => {
    expect(resolveCso({ kind: "auto", reference: rubles(700) }, { leads: 20, medianCostPerLead: rubles(560) })).toBe(rubles(560));
    expect(resolveCso({ kind: "auto", reference: rubles(700) }, { leads: 20, medianCostPerLead: rubles(2_000) })).toBe(rubles(1_050));
    expect(resolveCso({ kind: "auto", reference: rubles(700) }, { leads: 19, medianCostPerLead: rubles(560) })).toBe(rubles(700));
  });

  it("suggests raising an unreachable goal to the median rounded to 50 ₽", () => {
    expect(goalAdvice([rubles(420), rubles(460), rubles(480)], rubles(300))).toEqual({
      kind: "unreachable",
      medianCostPerLead: rubles(460),
      suggestedGoal: rubles(450),
    });
    expect(goalAdvice([rubles(280), rubles(480)], rubles(300))).toEqual({ kind: "reachable" });
    // «Поднять цель до 150 ₽» at a goal of 161 ₽ would be a cut: the suggestion goes up to the next 50 ₽.
    expect(goalAdvice([rubles(169), rubles(175)], rubles(161))).toMatchObject({ kind: "unreachable", suggestedGoal: rubles(200) });
  });
});

describe("classify", () => {
  const cso = rubles(700);
  it("keeps new objects in learning", () => {
    expect(classify(stats(700, 0), 4, cso)).toBe("learning");
  });
  it("marks spend without leads as ineffective", () => {
    expect(classify(stats(2_400, 0), 14, cso)).toBe("ineffective");
  });
  it("marks borderline cost per lead", () => {
    expect(classify(stats(2_850, 3), 14, cso)).toBe("borderline");
  });
  it("marks cheap leads as effective", () => {
    expect(classify(stats(1_800, 4), 14, cso)).toBe("effective");
  });
});

describe("guard", () => {
  it("clamps an agent limit increase to +20%", () => {
    const verdict = guard(baseState(), { type: "SetSpendLimit", directionId: "d1", weeklyLimit: rubles(5_600) }, "agent");
    expect(verdict).toMatchObject({ kind: "clamp", command: { weeklyLimit: rubles(3_360) }, reason: { code: "LIMIT_STEP_CLAMP" } });
  });

  it("rejects a second increase in the same turn once state reflects the first", () => {
    const state = baseState({ directions: [direction({ weeklyLimit: rubles(3_360), lastLimitIncreaseOn: "2026-10-12" })] });
    const verdict = guard(state, { type: "SetSpendLimit", directionId: "d1", weeklyLimit: rubles(4_032) }, "agent");
    expect(verdict).toMatchObject({ kind: "reject", reason: { code: "LIMIT_INCREASE_COOLDOWN" } });
  });

  it("clamps by remaining budget for every actor", () => {
    const state = baseState({ spentMonth: rubles(20_000), directions: [direction({ weeklyLimit: rubles(1_500) })] });
    const verdict = guard(state, { type: "SetSpendLimit", directionId: "d1", weeklyLimit: rubles(3_360) }, "user");
    // allowed total = (27 000 − 20 000) / 3 weeks left = 2 333 ₽
    expect(verdict).toMatchObject({ kind: "clamp", reason: { code: "BUDGET_CLAMP" } });
  });

  it("refuses a raise the remaining budget would cut to the current limit, so no empty change is logged", () => {
    const state = baseState({ spentMonth: rubles(20_000) });
    const verdict = guard(state, { type: "SetSpendLimit", directionId: "d1", weeklyLimit: rubles(3_360) }, "safety_net");
    // allowed 2 333 ₽ is below the current 2 800 ₽: there is nothing to add.
    expect(verdict).toMatchObject({ kind: "reject", reason: { code: "BUDGET_LIMIT_EXCEEDED" } });
  });

  it("makes no automated raise of a few rubles, but keeps the owner's clamped raise", () => {
    // allowed total = (27 000 − 20 000) / 3 weeks left = 2 333 ₽; the limit is 2 300 ₽: only 33 ₽ (1,4%) would be added.
    const state = baseState({ spentMonth: rubles(20_000), directions: [direction({ weeklyLimit: rubles(2_300) })] });
    const raise = { type: "SetSpendLimit", directionId: "d1", weeklyLimit: rubles(2_760) } as const;
    expect(guard(state, raise, "safety_net")).toMatchObject({ kind: "reject", reason: { code: "BUDGET_LIMIT_EXCEEDED" } });
    expect(guard(state, raise, "user")).toMatchObject({ kind: "clamp", reason: { code: "BUDGET_CLAMP" } });
  });

  it("rejects strategies outside the platform catalog and too frequent changes", () => {
    expect(guard(baseState(), { type: "SetStrategy", directionId: "d1", strategyId: "UNKNOWN" }, "agent")).toMatchObject({
      kind: "reject",
      reason: { code: "STRATEGY_NOT_IN_CATALOG" },
    });
    const recent = baseState({ directions: [direction({ lastStrategyChangeOn: "2026-10-09" })] });
    expect(guard(recent, { type: "SetStrategy", directionId: "d1", strategyId: "AVERAGE_CPA" }, "agent")).toMatchObject({
      kind: "reject",
      reason: { code: "STRATEGY_COOLDOWN" },
    });
  });

  it("rejects paying for leads when the business has no goal to count them", () => {
    const noGoal = baseState({ hasLeadGoal: false });
    expect(guard(noGoal, { type: "SetStrategy", directionId: "d1", strategyId: "AVERAGE_CPA" }, "agent")).toMatchObject({
      kind: "reject",
      reason: { code: "NO_LEAD_GOAL", message: "нет цели для подсчёта обращений" },
    });
    expect(guard(noGoal, { type: "SetStrategy", directionId: "d1", strategyId: "WB_MAXIMUM_CLICKS" }, "agent")).toMatchObject({ kind: "allow" });
  });

  it("does not pause the last active ad without a replacement", () => {
    const state = baseState({ ads: [ad("a1")], adClasses: new Map([["a1", "ineffective"]]) });
    expect(guard(state, { type: "PauseAd", adId: "a1" }, "agent")).toMatchObject({
      kind: "reject",
      reason: { code: "LAST_AD_NO_REPLACEMENT" },
    });
  });

  it("respects a user revert for 14 days", () => {
    const state = baseState({
      adClasses: new Map([["a1", "ineffective"]]),
      userDecisions: [{ objectId: "a1", commandType: "PauseAd", on: "2026-10-09" }],
    });
    expect(guard(state, { type: "PauseAd", adId: "a1" }, "agent")).toMatchObject({
      kind: "reject",
      reason: { code: "USER_DECISION" },
    });
  });

  it("rejects objects that do not belong to the business", () => {
    expect(guard(baseState(), { type: "PauseAd", adId: "foreign" }, "agent")).toMatchObject({
      kind: "reject",
      reason: { code: "OBJECT_NOT_FOUND", message: "объект не найден" },
    });
  });

  it("is deterministic", () => {
    const command = { type: "SetSpendLimit", directionId: "d1", weeklyLimit: rubles(5_600) } as const;
    expect(guard(baseState(), command, "agent")).toEqual(guard(baseState(), command, "agent"));
  });
});

describe("safety net", () => {
  it("pauses an ineffective ad the agent did not touch", () => {
    const state = baseState({ adClasses: new Map([["a1", "ineffective"], ["a2", "effective"]]) });
    const actions = safetyNet({
      state,
      directionClasses: new Map([["d1", "borderline"]]),
      touchedByAgent: new Set(),
      spendLast7Days: new Map(),
      leads14: new Map(),
      borderlineSince: new Map(),
      adsInExperiments: new Set(),
      agentActed: true,
    });
    expect(actions).toContainEqual({ kind: "command", command: { type: "PauseAd", adId: "a1" }, reasonCode: "SAFETY_PAUSE_AD" });
  });

  it("scales an effective direction that hits its limit", () => {
    const actions = safetyNet({
      state: baseState(),
      directionClasses: new Map([["d1", "effective"]]),
      touchedByAgent: new Set(),
      spendLast7Days: new Map([["d1", rubles(2_700)]]),
      leads14: new Map([["d1", 10]]),
      borderlineSince: new Map(),
      adsInExperiments: new Set(),
      agentActed: true,
    });
    expect(actions).toContainEqual({
      kind: "command",
      command: { type: "SetSpendLimit", directionId: "d1", weeklyLimit: rubles(3_360) },
      reasonCode: "SAFETY_SCALE_EFFECTIVE",
    });
  });

  it("starts an experiment for an ad borderline for 7 days", () => {
    const actions = safetyNet({
      state: baseState({ adClasses: new Map([["a1", "borderline"], ["a2", "effective"]]) }),
      directionClasses: new Map([["d1", "borderline"]]),
      touchedByAgent: new Set(),
      spendLast7Days: new Map(),
      leads14: new Map(),
      borderlineSince: new Map([["a1", "2026-10-05"]]),
      adsInExperiments: new Set(),
      agentActed: true,
    });
    expect(actions.some((a) => a.kind === "command" && a.command.type === "StartExperiment")).toBe(true);
  });

  it("waits 7 days for an agent that acted, but starts an experiment the same day when no turn took place", () => {
    const input = (agentActed: boolean) => ({
      state: baseState({ adClasses: new Map([["a1", "borderline"], ["a2", "effective"]]) }),
      directionClasses: new Map([["d1", "borderline"]] as const),
      touchedByAgent: new Set<string>(),
      spendLast7Days: new Map<string, number>(),
      leads14: new Map<string, number>(),
      borderlineSince: new Map([["a1", baseState().today]]),
      adsInExperiments: new Set<string>(),
      agentActed,
    });
    const started = (agentActed: boolean) => safetyNet(input(agentActed)).filter((a) => a.kind === "command" && a.command.type === "StartExperiment");
    expect(started(true)).toEqual([]);
    expect(started(false)).toHaveLength(1);
  });

  it("starts no experiment in advertising that is paused: a check without traffic proves nothing", () => {
    const actions = safetyNet({
      state: baseState({ directions: [{ ...direction(), status: "paused" }], adClasses: new Map([["a1", "borderline"], ["a2", "effective"]]) }),
      directionClasses: new Map([["d1", "borderline"]]),
      touchedByAgent: new Set(),
      spendLast7Days: new Map(),
      leads14: new Map(),
      borderlineSince: new Map([["a1", "2026-10-01"]]),
      adsInExperiments: new Set(),
      agentActed: false,
    });
    expect(actions.filter((a) => a.kind === "command" && a.command.type === "StartExperiment")).toEqual([]);
  });

  it("starts no experiment while one is running", () => {
    const actions = safetyNet({
      state: baseState({ adClasses: new Map([["a1", "borderline"], ["a2", "borderline"]]), activeExperiments: 1 }),
      directionClasses: new Map([["d1", "borderline"]]),
      touchedByAgent: new Set(),
      spendLast7Days: new Map(),
      leads14: new Map(),
      borderlineSince: new Map([["a1", "2026-10-01"], ["a2", "2026-10-01"]]),
      adsInExperiments: new Set(),
      agentActed: false,
    });
    expect(actions.filter((a) => a.kind === "command" && a.command.type === "StartExperiment")).toEqual([]);
  });
});

describe("A/B verdict", () => {
  const base = { experimentId: "exp-1", startedOn: "2026-10-01" };
  it("declares the variant a winner with enough data", () => {
    const outcome = evaluateExperiment({ ...base, today: "2026-10-13", control: stats(6_000, 4, 150), variant: stats(6_000, 14, 150) });
    expect(outcome.status).toBe("variant_wins");
  });
  it("ends without a difference after 21 days and keeps the control on a tie", () => {
    const outcome = evaluateExperiment({ ...base, today: "2026-10-22", control: stats(3_000, 3, 60), variant: stats(3_000, 3, 60) });
    expect(outcome).toMatchObject({ status: "no_difference", keep: "control" });
  });
  it("stops early when the variant is clearly worse", () => {
    const outcome = evaluateExperiment({ ...base, today: "2026-10-08", control: stats(6_000, 15, 150), variant: stats(6_000, 2, 150) });
    expect(outcome.status).toBe("control_wins_early");
  });
  it("does not call a variant without clicks clearly worse", () => {
    expect(evaluateExperiment({ ...base, today: "2026-10-08", control: stats(0, 0, 0), variant: stats(0, 0, 0) }).status).toBe("running");
    expect(evaluateExperiment({ ...base, today: "2026-10-08", control: stats(3_000, 4, 80), variant: stats(0, 0, 0) }).status).toBe("running");
  });
  it("is deterministic for the same experiment", () => {
    const input = { ...base, today: "2026-10-13", control: stats(5_000, 6, 120), variant: stats(5_000, 9, 120) };
    expect(evaluateExperiment(input)).toEqual(evaluateExperiment(input));
  });
});

describe("explanation validator", () => {
  const facts = [
    { kind: "rub", value: 2_400 },
    { kind: "rub", value: 600 },
    { kind: "count", value: 0 },
  ] as const;
  it("accepts the spec example", () => {
    const text = "Отключил объявление: за 2 недели оно потратило 2 400 ₽ и не привело ни одного обращения, а остальные приводят клиента в среднем за 600 ₽";
    expect(validateExplanation(text, facts)).toEqual([]);
  });
  it("rejects numbers that are not in the data", () => {
    expect(validateExplanation("потратило 3 000 ₽", facts)).toEqual([
      { code: "UNKNOWN_NUMBER", message: "число 3 000 ₽ не найдено в данных" },
    ]);
  });
  it("rejects jargon", () => {
    expect(validateExplanation("снизили ставку из-за низкого CTR", facts).map((i) => i.code)).toEqual(["JARGON", "JARGON"]);
    expect(validateExplanation("Ставки на телефоны снижены", facts).map((i) => i.code)).toEqual(["JARGON"]);
  });
  it("finds jargon only from the start of a word: «доставка» is a plain word", () => {
    expect(validateExplanation("Запрос «букет с доставкой» приводит клиентов, доставка цветов тоже", facts)).toEqual([]);
  });
});
