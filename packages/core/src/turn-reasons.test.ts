import { describe, expect, it } from "vitest";
import type { GuardState } from "./guard";
import { evaluationFindings, turnReasons } from "./turn-reasons";
import type { FindingsInput } from "./turn-reasons";
import type { Ad, Direction, EffectivenessClass, PerformanceStats } from "./types";
import { rubles } from "./types";

const stats = (spendRub: number, leads: number): PerformanceStats => ({ impressions: 2_000, clicks: 100, leads, spend: rubles(spendRub) });

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

const ad = (id: string): Ad => ({ id, directionId: "d1", status: "active", title: "Маникюр у метро", text: "Маникюр с покрытием", createdOn: "2026-09-01" });

const state = (adClasses: [string, EffectivenessClass][], overrides: Partial<GuardState> = {}): GuardState => ({
  today: "2026-10-12",
  cso: rubles(800),
  monthBudget: rubles(30_000),
  spentMonth: rubles(5_000),
  directions: [direction()],
  ads: [ad("a1"), ad("a2")],
  adClasses: new Map(adClasses),
  directionStats14: new Map([["d1", stats(5_200, 10)]]),
  userDecisions: [],
  strategyCatalog: ["WB_MAXIMUM_CLICKS"],
  leadGoalStrategies: [],
  hasLeadGoal: true,
  minWeeklyLimit: rubles(300),
  activeExperiments: 0,
  ...overrides,
});

const input = (overrides: Partial<FindingsInput> = {}): FindingsInput => ({
  state: state([
    ["a1", "effective"],
    ["a2", "learning"],
  ]),
  directionClasses: new Map([["d1", "learning"]]),
  borderlineSince: new Map(),
  adsInExperiments: new Set(),
  spendLast7Days: new Map([["d1", rubles(1_000)]]),
  directionLast7: new Map([["d1", stats(1_000, 2)]]),
  directionPrevious7: new Map([["d1", stats(1_000, 2)]]),
  hypothesesDue: [],
  ...overrides,
});

const none = new Set<string>();

describe("evaluation findings", () => {
  it("names an ineffective ad and an object that left «Собираем данные»", () => {
    const findings = evaluationFindings(input({ state: state([["a1", "ineffective"], ["a2", "learning"]]) }));
    expect(findings).toEqual(["classified:ad:a1", "ineffective:ad:a1"]);
  });

  it("finds room for a raise only where the safety net could raise", () => {
    const capped = input({ directionClasses: new Map([["d1", "effective"]]), spendLast7Days: new Map([["d1", rubles(2_600)]]) });
    expect(evaluationFindings(capped)).toContain("scale:direction:d1");
    // Below 90% of the limit, or raised two days ago: no room.
    expect(evaluationFindings({ ...capped, spendLast7Days: new Map([["d1", rubles(2_400)]]) })).not.toContain("scale:direction:d1");
    expect(evaluationFindings({ ...capped, state: { ...capped.state, directions: [direction({ lastLimitIncreaseOn: "2026-10-10" })] } })).not.toContain("scale:direction:d1");
    // The month's money is almost spent: the guard would refuse a raise of a few rubles.
    expect(evaluationFindings({ ...capped, state: { ...capped.state, spentMonth: rubles(29_000) } })).not.toContain("scale:direction:d1");
  });

  it("names a borderline ad a day before the safety net may start its check", () => {
    const borderline = (since: string) =>
      evaluationFindings(input({ state: state([["a1", "borderline"], ["a2", "effective"]]), borderlineSince: new Map([["a1", since]]) }));
    expect(borderline("2026-10-07")).not.toContain("borderline:ad:a1");
    expect(borderline("2026-10-06")).toContain("borderline:ad:a1");
    expect(
      evaluationFindings(input({ state: state([["a1", "borderline"]]), borderlineSince: new Map([["a1", "2026-10-01"]]), adsInExperiments: new Set(["a1"]) })),
    ).not.toContain("borderline:ad:a1");
  });

  it("sees a sharp week-on-week change only above 50% and with enough leads", () => {
    const swing = (last: PerformanceStats, previous: PerformanceStats) =>
      evaluationFindings(input({ directionLast7: new Map([["d1", last]]), directionPrevious7: new Map([["d1", previous]]) })).filter((f) => f.startsWith("swing"));
    expect(swing(stats(1_000, 2), stats(1_000, 6))).toEqual(["swing:direction:d1:leads:down", "swing:direction:d1:cpl:up"]);
    // 49% fewer leads is not sharp; 51% is.
    expect(swing(stats(1_000, 49), stats(1_000, 100)).filter((f) => f.includes("leads"))).toEqual(["swing:direction:d1:leads:down"]);
    expect(swing(stats(1_000, 51), stats(1_000, 100)).filter((f) => f.includes("leads"))).toEqual([]);
    // Two leads against none is noise; three is enough.
    expect(swing(stats(600, 2), stats(600, 0))).toEqual([]);
    expect(swing(stats(600, 3), stats(600, 0))).toEqual(["swing:direction:d1:leads:up"]);
  });

  it("compares weeks only when the advertising ran through both", () => {
    const young = input({
      state: { ...input().state, directions: [direction({ createdOn: "2026-10-01" })] },
      directionLast7: new Map([["d1", stats(1_000, 5)]]),
      directionPrevious7: new Map([["d1", stats(0, 0)]]),
    });
    expect(evaluationFindings(young).filter((f) => f.startsWith("swing"))).toEqual([]);
  });

  it("names a hypothesis on its check day", () => {
    expect(evaluationFindings(input({ hypothesesDue: [{ id: "h1", checkOn: "2026-10-12" }] }))).toContain("hypothesis:h1:2026-10-12");
  });
});

describe("turn reasons", () => {
  it("gives a reason for a finding the last turn did not see", () => {
    expect(turnReasons(["classified:ad:a1", "ineffective:ad:a1"], new Set(["classified:ad:a1"]), new Set(["classified:ad:a1"]))).toEqual([
      { kind: "became_ineffective", key: "ineffective:ad:a1", objectKind: "ad", objectId: "a1" },
    ]);
  });

  it("gives none for a finding the last turn already saw", () => {
    const seen = new Set(["scale:direction:d1"]);
    expect(turnReasons(["scale:direction:d1"], seen, seen)).toEqual([]);
  });

  it("gives a reason again when a finding disappeared and came back", () => {
    expect(turnReasons(["scale:direction:d1"], none, new Set(["scale:direction:d1"]))).toEqual([
      { kind: "scale", key: "scale:direction:d1", objectKind: "direction", objectId: "d1" },
    ]);
  });

  it("gives a reason when an object the last turn saw as ineffective is no longer so", () => {
    const seen = new Set(["ineffective:direction:d1"]);
    expect(turnReasons([], seen, seen)).toEqual([{ kind: "no_longer_ineffective", key: "ineffective:direction:d1", objectKind: "direction", objectId: "d1" }]);
  });

  it("names the hypothesis of a check day", () => {
    expect(turnReasons(["hypothesis:h1:2026-10-12"], none, none)).toEqual([{ kind: "hypothesis_due", key: "hypothesis:h1:2026-10-12", objectKind: "hypothesis", objectId: "h1" }]);
  });
});
