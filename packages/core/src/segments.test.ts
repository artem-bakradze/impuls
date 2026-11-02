import { describe, expect, it } from "vitest";
import { analystDecisionKey, guard } from "./guard";
import type { DirectionAnalystState, GuardState } from "./guard";
import { filterQueries, phraseMatches, segmentVerdict } from "./segments";
import type { SegmentStats } from "./segments";
import { rubles } from "./types";

const row = (segment: string, spendRub: number, leads: number, clicks = 30, impressions = 400): SegmentStats => ({ segment, impressions, clicks, leads, spend: rubles(spendRub) });

describe("segment verdict (ad-agent spec «Разрезы данных по запросу агента»)", () => {
  const goal = rubles(500);
  it("calls a segment without leads that spent the goal «дороже цели»", () => {
    expect(segmentVerdict(row("маникюр бесплатно", 640, 0, 18), goal)).toBe("above");
  });
  it("waits for data while there is no lead and less than the goal spent, whatever the clicks", () => {
    expect(segmentVerdict(row("tablet", 120, 0, 4), goal)).toBe("learning");
    expect(segmentVerdict(row("tablet", 400, 0, 40), goal)).toBe("learning");
  });
  it("needs 3 leads before a cost per lead above the goal counts, and never calls one or two expensive leads «в цели»", () => {
    expect(segmentVerdict(row("mobile", 3_300, 3), goal)).toBe("above");
    expect(segmentVerdict(row("mobile", 1_300, 2), goal)).toBe("learning");
    expect(segmentVerdict(row("desktop", 1_260, 3), goal)).toBe("within");
    expect(segmentVerdict(row("desktop", 300, 1, 5), goal)).toBe("within");
  });
});

describe("search queries sent to the model (design decision 6)", () => {
  it("drops phone numbers, e-mails, sites and rare queries and says how many", () => {
    const { rows, hidden } = filterQueries([
      row("маникюр бесплатно", 640, 0, 18),
      row("маникюр 89161234567", 90, 0, 3),
      row("ногти anna@mail.ru", 60, 0, 3),
      row("маникюр nogotok.ru", 50, 0, 3),
      row("маникюр редкий", 20, 0, 1, 4),
    ]);
    expect(rows.map((r) => r.segment)).toEqual(["маникюр бесплатно"]);
    expect(hidden).toBe(4);
  });
  it("keeps at most 30 queries, the most expensive first", () => {
    const many = Array.from({ length: 40 }, (_, i) => row(`запрос ${String.fromCharCode(1072 + (i % 26))}${i}`, 100 + i, 0, 5));
    const { rows } = filterQueries(many);
    expect(rows).toHaveLength(30);
    expect(rows[0]?.spend).toBe(rubles(139));
  });
  it("matches a negative phrase by all of its words", () => {
    expect(phraseMatches("бесплатно", "маникюр бесплатно москва")).toBe(true);
    expect(phraseMatches("маникюр обучение", "обучение маникюру")).toBe(false);
    expect(phraseMatches("Маникюр, москва", "маникюр москва")).toBe(true);
  });
});

const analyst = (overrides: Partial<DirectionAnalystState> = {}): DirectionAnalystState => ({
  keywords: ["маникюр москва", "маникюр у метро"],
  negativeKeywords: [],
  deviceAdjustments: { mobile: 0, desktop: 0 },
  deviceAdjustedOn: { mobile: null, desktop: null },
  negativeAddedToday: 0,
  queries: [row("маникюр бесплатно", 640, 0, 18), row("маникюр москва недорого", 900, 3), row("маникюр обучение", 120, 0, 5)],
  devices: [row("mobile", 3_300, 3, 90), row("desktop", 1_260, 3, 60), row("tablet", 40, 0, 8)],
  ...overrides,
});

const state = (directionAnalyst: DirectionAnalystState = analyst(), overrides: Partial<GuardState> = {}): GuardState => ({
  today: "2026-10-12",
  cso: rubles(500),
  monthBudget: rubles(30_000),
  spentMonth: rubles(5_000),
  directions: [
    { id: "d1", businessId: "b1", name: "Маникюр — Поиск", channel: "search", status: "active", weeklyLimit: rubles(2_000), strategyId: "WB_MAXIMUM_CLICKS", createdOn: "2026-09-01", lastLimitIncreaseOn: null, lastStrategyChangeOn: null },
  ],
  ads: [],
  adClasses: new Map(),
  directionStats14: new Map(),
  userDecisions: [],
  strategyCatalog: ["WB_MAXIMUM_CLICKS"],
  leadGoalStrategies: [],
  hasLeadGoal: true,
  minWeeklyLimit: rubles(300),
  activeExperiments: 0,
  analyst: new Map([["d1", directionAnalyst]]),
  ...overrides,
});

const negative = (...phrases: string[]) => ({ type: "AddNegativeKeywords" as const, directionId: "d1", phrases });

describe("guards of negative phrases (optimization-engine spec «Ограничители минус-фраз»)", () => {
  it("allows a phrase of a query that costs more than the goal", () => {
    expect(guard(state(), negative("Бесплатно"), "agent")).toEqual({ kind: "allow", command: negative("бесплатно") });
  });
  it("refuses a phrase that would switch off the direction's own key phrases", () => {
    expect(guard(state(), negative("маникюр"), "agent")).toMatchObject({ kind: "reject", reason: { message: "эта минус-фраза отключит показы по вашим основным запросам" } });
  });
  it("refuses a query that brings leads within the goal", () => {
    expect(guard(state(), negative("недорого"), "agent")).toMatchObject({ kind: "reject", reason: { message: "этот запрос приводит обращения в цели" } });
  });
  it("refuses a query still collecting data and a phrase of no query", () => {
    expect(guard(state(), negative("обучение"), "agent")).toMatchObject({ kind: "reject", reason: { message: "по этому запросу ещё мало данных" } });
    expect(guard(state(), negative("курсы"), "agent")).toMatchObject({ kind: "reject", reason: { message: "такого поискового запроса у рекламы нет" } });
  });
  it("refuses an eleventh phrase a day and a phrase the owner took back", () => {
    expect(guard(state(analyst({ negativeAddedToday: 10 })), negative("бесплатно"), "agent")).toMatchObject({ kind: "reject", reason: { message: "минус-фраз на сегодня достаточно, вернёмся к ним завтра" } });
    const decided = state(analyst(), { userDecisions: [{ objectId: analystDecisionKey("d1", "бесплатно"), commandType: "AddNegativeKeywords", on: "2026-10-05" }] });
    expect(guard(decided, negative("бесплатно"), "agent")).toMatchObject({ kind: "reject", reason: { code: "USER_DECISION" } });
  });
  it("leaves the owner free and keeps the rules from removing phrases", () => {
    expect(guard(state(), negative("маникюр"), "user").kind).toBe("allow");
    expect(guard(state(), { type: "RemoveNegativeKeywords", directionId: "d1", phrases: ["бесплатно"] }, "agent").kind).toBe("reject");
  });
});

const adjust = (device: "mobile" | "desktop", percent: number) => ({ type: "SetDeviceAdjustment" as const, directionId: "d1", device, percent });

describe("guards of device bid adjustments (optimization-engine spec «Ограничители корректировок по устройствам»)", () => {
  it("cuts a step to 25 points and the range to 50%", () => {
    expect(guard(state(), adjust("mobile", -80), "agent")).toEqual({ kind: "clamp", command: adjust("mobile", -25), reason: { code: "DEVICE_STEP_CLAMP", message: "урезано: не больше 25 пунктов за шаг" } });
    const near = state(analyst({ deviceAdjustments: { mobile: -40, desktop: 0 } }));
    expect(guard(near, adjust("mobile", -80), "agent")).toMatchObject({ kind: "clamp", command: adjust("mobile", -50), reason: { code: "DEVICE_RANGE_CLAMP" } });
    expect(guard(state(), adjust("mobile", -30), "agent")).toMatchObject({ kind: "clamp", command: adjust("mobile", -25) });
    expect(guard(state(), adjust("desktop", 20), "agent")).toEqual({ kind: "allow", command: adjust("desktop", 20) });
  });
  it("refuses a device with little data and a change sooner than a week", () => {
    const few = state(analyst({ devices: [row("mobile", 80, 0, 8)] }));
    expect(guard(few, adjust("mobile", -20), "agent")).toMatchObject({ kind: "reject", reason: { message: "по этому устройству ещё мало данных" } });
    const recent = state(analyst({ deviceAdjustedOn: { mobile: "2026-10-09", desktop: null } }));
    expect(guard(recent, adjust("mobile", -20), "agent")).toMatchObject({ kind: "reject", reason: { message: "корректировку этого устройства можно менять не чаще раза в 7 дней" } });
  });
  it("needs the analyst state of the direction", () => {
    expect(guard(state(analyst(), { analyst: new Map() }), adjust("mobile", -20), "agent")).toMatchObject({ kind: "reject", reason: { code: "NO_SEGMENT_DATA" } });
  });
});
