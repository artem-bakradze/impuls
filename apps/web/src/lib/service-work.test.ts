import { rubles } from "@impuls/core";
import type { ChangeEntry } from "@impuls/worker";
import { describe, expect, it } from "vitest";
import { groupRub } from "./format";
import type { HistoryItem } from "./history-view";
import type { DayReviewModel, InsightCardModel } from "./insights-model";
import { briefChange, buildServiceWork } from "./service-work";

const item = (overrides: Partial<HistoryItem>): HistoryItem => ({
  id: "c1",
  at: "2026-11-05T09:00:00Z",
  author: "user",
  object: "Реклама в поиске",
  diff: [{ label: "Время показа", before: "Пн–Вс 10:00–20:00", after: "Пн–Вс 10:00–21:00" }],
  explanation: "Вы изменили время показа.",
  outcome: null,
  turnId: null,
  insight: null,
  status: "applied",
  reverted: false,
  rollback: { kind: "available", consequences: [] },
  budgetAdjustment: false,
  ...overrides,
});

const review: DayReviewModel = {
  date: "2026-11-04",
  from: null,
  summary: "**Разбор дня:** пока ничего не меняю: реклама собирает данные.",
  quiet: false,
  rulesReason: null,
  insights: [],
  weekly: null,
};

const build = (history: HistoryItem[], reviews: DayReviewModel[] = [review], changes: ChangeEntry[] = []) =>
  buildServiceWork({
    ads: [],
    directions: [],
    stats: [],
    today: "2026-11-10",
    startedOn: "2026-11-01",
    timeZone: "Europe/Moscow",
    cso: rubles(500),
    reviews,
    history,
    changes,
    openChecks: [],
    weeks: [{ week: 1, from: "2026-11-01", reviewedOn: "2026-11-08" }, { week: 2, from: "2026-11-08", reviewedOn: "2026-11-15" }],
  });

describe("the journal is the history (insights spec «Лента инсайтов и связь с историей»)", () => {
  it("tells the owner's change in one line with its rollback, after the day's review", () => {
    const work = build([item({})]);
    const entries = work.journal.flatMap((s) => s.entries);
    expect(entries.map((e) => e.kind)).toEqual(["agent", "owner"]);
    const change = entries[1]?.changes[0];
    expect(change?.text).toBe("Вы: Реклама в поиске — время показа: было Пн–Вс 10:00–20:00 → стало Пн–Вс 10:00–21:00");
    expect(change?.item?.rollback.kind).toBe("available");
    expect(entries[0]?.headline).toBe("Пока ничего не меняю: реклама собирает данные.");
  });

  it("leaves the budget guard's limit cuts out: the budget line covers them", () => {
    const work = build([item({ id: "b1", author: "service", budgetAdjustment: true, explanation: "Лимит подстроен под остаток бюджета." })]);
    expect(work.journal.flatMap((s) => s.entries).some((e) => e.changes.some((c) => c.historyId === "b1"))).toBe(false);
  });

  it("names the launch and the Direct cabinet's changes in the owner's words", () => {
    const work = build([
      item({ id: "l1", at: "2026-11-01T06:00:00Z", reasonCode: "LAUNCH", diff: [{ label: "Реклама", before: "не запущена", after: "запущена" }] }),
      item({ id: "k1", author: "cabinet", at: "2026-11-09T06:00:00Z" }),
    ], []);
    const texts = work.journal.flatMap((s) => s.entries).flatMap((e) => e.changes.map((c) => c.text));
    expect(texts[0]).toBe("Вы: реклама запущена");
    expect(texts[1]?.startsWith("В кабинете Директа: Реклама в поиске")).toBe(true);
    expect(work.journal.map((s) => s.week)).toEqual([1, 2]);
  });

  it("names the ad the owner switched off", () => {
    const work = build([item({ object: "Объявление «Маникюр у метро»", decisionText: "Отключили объявление", diff: [] })], []);
    expect(work.journal[0]?.entries[0]?.changes[0]?.text).toBe("Вы: отключили объявление «Маникюр у метро»");
  });

  it("has no scenario truth without a simulation", () => {
    const work = build([]);
    expect(work.journal.flatMap((s) => s.entries).every((e) => e.truths.length === 0)).toBe(true);
  });
});

const change = (overrides: Partial<ChangeEntry>): ChangeEntry => ({
  id: "d1",
  businessId: "b1",
  actor: "agent",
  author: "service",
  action: { type: "SetDeviceAdjustment", directionId: "dir1", device: "desktop", percent: 10 },
  objectKind: "direction",
  objectId: "dir1",
  before: {},
  after: {},
  status: "applied",
  reasonCode: "AGENT",
  explanation: "Поднял цену перехода. Подробности в истории.",
  turnId: null,
  insightId: null,
  createdAt: new Date("2026-11-08T07:00:00Z"),
  error: null,
  revertedById: null,
  outcome: null,
  ...overrides,
});

const card = (overrides: Partial<InsightCardModel>): InsightCardModel => ({
  id: "i1",
  author: "agent",
  at: "2026-11-08T07:00:00Z",
  observation: "с компьютеров получено 3 обращения по 414 ₽ при цели 1000 ₽",
  facts: [],
  decision: { text: "Поднял цену перехода с компьютеров на 10%", status: "applied" },
  next: "",
  rollback: null,
  truth: null,
  objectIds: [],
  ...overrides,
});

describe("money in the service's own words (analytics spec «Сводка»)", () => {
  it("groups the digits of rubles in free text and leaves other numbers alone", () => {
    expect(groupRub("при цели 1000 ₽, в поиске — 1334₽")).toBe("при цели 1\u00a0000\u00a0₽, в поиске — 1\u00a0334\u00a0₽");
    expect(groupRub("в 2026 году 403 показа за 12 345 ₽")).toBe("в 2026 году 403 показа за 12 345 ₽");
  });

  it("groups the rubles of the agent's review in the journal", () => {
    const work = build([], [{ ...review, summary: "Стоимость обращения 1334 ₽ при цели 1000 ₽." }]);
    expect(work.journal[0]?.entries[0]?.headline).toBe("Стоимость обращения 1\u00a0334\u00a0₽ при цели 1\u00a0000\u00a0₽.");
  });
});

describe("the latest changes on the main screen (change-history spec «Последнее изменение на главном экране»)", () => {
  it("names the price of a visit in the history's words, never «клик»", () => {
    expect(briefChange(change({}))).toBe("Цена перехода +10%");
    expect(briefChange(change({ action: { type: "SetDeviceAdjustment", directionId: "dir1", device: "mobile", percent: -30 } }))).toBe("Цена перехода −30%");
  });

  it("keeps up to three decisions not reverted, newest first, each with its reason", () => {
    const reviews: DayReviewModel[] = [{ ...review, date: "2026-11-08", summary: null, insights: [card({})] }];
    const work = build([], reviews, [
      change({ id: "d1", insightId: "i1", createdAt: new Date("2026-11-08T07:00:00Z") }),
      change({ id: "d2", createdAt: new Date("2026-11-07T07:00:00Z"), action: { type: "PauseAd", adId: "a1" }, objectKind: "ad", objectId: "a1", explanation: "Отключил объявление: за 10 дней 2400 ₽ без обращений. Деньги пойдут другим." }),
      change({ id: "d3", createdAt: new Date("2026-11-06T07:00:00Z"), revertedById: "r1" }),
      change({ id: "d4", createdAt: new Date("2026-11-05T07:00:00Z") }),
      change({ id: "d5", createdAt: new Date("2026-11-04T07:00:00Z") }),
      change({ id: "g1", createdAt: new Date("2026-11-09T07:00:00Z"), actor: "budget_guard", reasonCode: "BUDGET_FIT", action: { type: "SetSpendLimit", directionId: "dir1", weeklyLimit: rubles(1_000) } }),
    ]);
    expect(work.recentChanges.map((c) => c.historyId)).toEqual(["d1", "d2", "d4"]);
    expect(work.recentChanges[0]?.reason).toBe("С компьютеров получено 3 обращения по 414 ₽ при цели 1\u00a0000\u00a0₽.");
    expect(work.recentChanges[1]?.reason).toBe("Отключил объявление: за 10 дней 2\u00a0400\u00a0₽ без обращений.");
    expect(work.lastChange?.historyId).toBe("d1");
    expect(work.changesLast7).toBe(5);
  });
});
