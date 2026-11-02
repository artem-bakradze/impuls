import { describe, expect, it } from "vitest";
import type { HypothesisRecord, InsightRecord, TurnDigest } from "@impuls/worker";
import type { HistoryItem } from "./history-view";
import { factLabel, factValue, feedDays } from "./insights-model";

const plain = (text: string) => text.replace(/[  ]/g, " ");

const insight = (id: string, at: string, overrides: Partial<InsightRecord> = {}): InsightRecord => ({
  id,
  businessId: "b1",
  turnId: "t1",
  source: "agent",
  reasonCode: "PAUSE_INEFFECTIVE",
  observation: "Объявление «Маникюр без записи» тратит деньги и не приводит клиентов.",
  facts: [
    { key: "ad:a2:spend:14d", object: "объявление «Маникюр без записи»", metric: "spend", period: "14d", value: 1_530, unit: "rub" },
    { key: "ad:a2:leads:14d", object: "объявление «Маникюр без записи»", metric: "leads", period: "14d", value: 0, unit: "count" },
    { key: "goal:goal:now", object: "цель", metric: "goal", period: "now", value: 500, unit: "rub" },
  ],
  decision: { kind: "action", text: "Отключили объявление «Маникюр без записи»", status: "applied", changeIds: ["c1"] },
  next: "Через 7 дней сравним цену обращения рекламы в поиске с прежней.",
  objectRef: { kind: "ad", id: "a2" },
  createdAt: new Date(at),
  ...overrides,
});

const turn = (id: string, at: string, overrides: Partial<TurnDigest> = {}): TurnDigest => ({
  id,
  trigger: "daily_review",
  status: "completed",
  startedAt: new Date(at),
  summary: "Отключили одно объявление: оно тратило деньги без обращений.",
  summaryValid: true,
  ...overrides,
});

const entry = (id: string, available: boolean): HistoryItem => ({
  id,
  at: "2026-11-08T03:00:00Z",
  author: "service",
  object: "Объявление «Маникюр без записи»",
  diff: [],
  explanation: "",
  outcome: null,
  turnId: null,
  insight: null,
  status: "applied",
  reverted: !available,
  rollback: available ? { kind: "available", consequences: [] } : { kind: "unavailable", reason: "Уже отменено." },
  budgetAdjustment: false,
});

const marker = (at: string, reason: string): InsightRecord =>
  insight(`m-${at}`, at, { reasonCode: "RULES_DAY", source: "rule", turnId: null, observation: `Сегодня решения принимали страховочные правила: ${reason}`, facts: [], objectRef: null, next: "", decision: { kind: "none", text: "", status: "none", changeIds: [] } });

const hypothesis = (id: string, statement: string, openedAt: string, overrides: Partial<HypothesisRecord> = {}): HypothesisRecord => ({
  id,
  businessId: "b1",
  openedTurnId: "w0",
  closedTurnId: null,
  statement,
  facts: [],
  check: "Сравним цену обращения",
  checkOn: "2026-11-18",
  status: "checking",
  result: null,
  resultFacts: [],
  openedAt: new Date(openedAt),
  closedAt: null,
  ...overrides,
});

describe("weekly review in the feed (insights spec «Разбор недели в ленте»)", () => {
  const timeZone = "Europe/Moscow";
  const phones = hypothesis("h1", "С телефонов клиенты обходятся дороже", "2026-11-02T04:00:00Z", {
    status: "confirmed",
    result: "Цена обращения снизилась после снижения цены перехода с телефонов.",
    closedAt: new Date("2026-11-09T04:10:00Z"),
    closedTurnId: "w1",
  });
  const training = hypothesis("h2", "Запросы со словом «обучение» не приводят клиентов", "2026-11-09T04:12:00Z");
  const old = hypothesis("h3", "Старая гипотеза", "2026-10-12T04:00:00Z", { status: "dropped", closedAt: new Date("2026-10-26T04:00:00Z") });

  it("groups the Monday's message, «Выяснили», «Проверяем» and the weekly turn's insights apart from the day's review", () => {
    const days = feedDays({
      insights: [insight("i1", "2026-11-09T03:05:00Z", { turnId: "d1" }), insight("i2", "2026-11-09T04:11:00Z", { turnId: "w1", decision: { kind: "none", text: "Пока ничего не меняем", status: "none", changeIds: [] } })],
      turns: [turn("d1", "2026-11-09T03:00:00Z"), turn("w1", "2026-11-09T04:00:00Z", { trigger: "weekly_review", summary: "За неделю подтвердили, что телефоны дороже." })],
      timeZone,
      since: null,
      entries: new Map(),
      hypotheses: [phones, training, old],
    });
    const [monday] = days;
    expect(monday?.summary).toBe("Отключили одно объявление: оно тратило деньги без обращений.");
    expect(monday?.insights.map((i) => i.id)).toEqual(["i1"]);
    expect(monday?.weekly).toEqual({
      summary: "За неделю подтвердили, что телефоны дороже.",
      found: [{ id: "h1", statement: "С телефонов клиенты обходятся дороже", check: "Сравним цену обращения", checkOn: "2026-11-18", outcome: "подтвердилась", result: "Цена обращения снизилась после снижения цены перехода с телефонов." }],
      checking: [{ id: "h2", statement: "Запросы со словом «обучение» не приводят клиентов", check: "Сравним цену обращения", checkOn: "2026-11-18", outcome: null, result: null }],
      insights: [expect.objectContaining({ id: "i2" })],
    });
  });

  it("shows only the hypotheses and insights when the weekly message failed the checks, and no group on other days", () => {
    const days = feedDays({
      insights: [],
      turns: [turn("w1", "2026-11-09T04:00:00Z", { trigger: "weekly_review", summary: "Ваш CTR вырос", summaryValid: false }), turn("d2", "2026-11-10T03:00:00Z")],
      timeZone,
      since: null,
      entries: new Map(),
      hypotheses: [training],
    });
    expect(days.map((d) => [d.date, d.weekly?.summary ?? null, d.weekly?.checking.length ?? null])).toEqual([
      ["2026-11-10", null, null],
      ["2026-11-09", null, 1],
    ]);
  });
});

describe("facts of an insight (insights spec «Инсайт»)", () => {
  it("names the object, the measure and the time, with the value from the snapshot", () => {
    const [spend, leads, goal] = insight("i1", "2026-11-08T03:00:00Z").facts;
    if (!spend || !leads || !goal) throw new Error("facts");
    expect(factLabel(spend)).toBe("Объявление «Маникюр без записи»: расход за 14 дней");
    expect(plain(factValue(spend))).toBe("1 530 ₽");
    expect(factValue(leads)).toBe("0");
    expect(factLabel(goal)).toBe("Цель");
    expect(plain(factValue(goal))).toBe("500 ₽ за обращение");
    expect(factLabel({ object: "бюджет месяца", metric: "budget_left", period: "month" })).toBe("Осталось в этом месяце");
    expect(factLabel({ object: "реклама в поиске", metric: "spend", period: "prev7d" })).toBe("Реклама в поиске: расход за 7 дней до этого");
    expect(plain(factValue({ metric: "weekly_limit", unit: "rub", value: 2_000 }))).toBe("2 000 ₽ в неделю");
  });
});

describe("day reviews of the feed (insights spec «Разбор дня»)", () => {
  const timeZone = "Europe/Moscow";

  it("groups the insights under the day's review, newest first, with «Вернуть как было» while it is possible", () => {
    const days = feedDays({
      insights: [insight("i1", "2026-11-08T03:00:00Z"), insight("i2", "2026-11-08T12:00:00Z", { decision: { kind: "action", text: "Лимит", status: "clamped", changeIds: ["c2"] } })],
      turns: [turn("t1", "2026-11-08T03:00:00Z")],
      timeZone,
      since: null,
      entries: new Map([
        ["c1", entry("c1", true)],
        ["c2", entry("c2", false)],
      ]),
    });
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ date: "2026-11-08", summary: "Отключили одно объявление: оно тратило деньги без обращений.", quiet: false, rulesReason: null });
    expect(days[0]?.insights.map((i) => i.id)).toEqual(["i2", "i1"]);
    expect(days[0]?.insights[1]?.rollback?.id).toBe("c1");
    expect(days[0]?.insights[0]?.rollback).toBeNull();
  });

  it("shows a turn without insights as one line, and a review that failed the checks not at all", () => {
    const days = feedDays({ insights: [], turns: [turn("t1", "2026-11-09T03:00:00Z", { summary: "Ваш CTR вырос", summaryValid: false })], timeZone, since: null, entries: new Map() });
    expect(days).toEqual([{ date: "2026-11-09", from: null, summary: null, quiet: true, rulesReason: null, insights: [], weekly: null }]);
  });

  it("says why the rules decided alone, and makes one line of the days they marked and did nothing on", () => {
    const rule = insight("r1", "2026-11-10T03:00:00Z", { source: "rule", turnId: null, reasonCode: "SAFETY_PAUSE_AD" });
    const unavailable = "помощник был недоступен";
    const days = feedDays({
      insights: [
        marker("2026-11-10T03:00:00Z", unavailable),
        rule,
        marker("2026-11-11T03:00:00Z", unavailable),
        marker("2026-11-12T03:00:00Z", unavailable),
        marker("2026-11-13T03:00:00Z", "лимит расходов на помощника исчерпан"),
      ],
      turns: [turn("t-failed", "2026-11-10T03:00:00Z", { status: "failed" })],
      timeZone,
      since: null,
      entries: new Map(),
    });
    expect(days.map((d) => [d.from, d.date, d.rulesReason])).toEqual([
      [null, "2026-11-13", "Сегодня решения принимали страховочные правила: лимит расходов на помощника исчерпан"],
      ["2026-11-11", "2026-11-12", "Решения принимали страховочные правила: помощник был недоступен"],
      [null, "2026-11-10", "Сегодня решения принимали страховочные правила: помощник был недоступен"],
    ]);
    expect(days[2]).toMatchObject({ summary: null, quiet: false });
    expect(days[2]?.insights.map((i) => i.author)).toEqual(["rule"]);
  });

  it("keeps only the days of the period and compares the truth with the goal of the decision", () => {
    const seen: (number | null)[] = [];
    const days = feedDays({
      insights: [insight("old", "2026-11-01T03:00:00Z"), insight("new", "2026-11-08T03:00:00Z")],
      turns: [],
      timeZone,
      since: "2026-11-02",
      entries: new Map(),
      truthOf: (_ref, goal) => {
        seen.push(goal);
        return { text: "На самом деле: объявление не приводит обращений", tone: "danger" };
      },
    });
    expect(days.map((d) => d.date)).toEqual(["2026-11-08"]);
    expect(days[0]?.insights[0]?.truth?.text).toBe("На самом деле: объявление не приводит обращений");
    expect(seen).toEqual([50_000]);
  });
});
