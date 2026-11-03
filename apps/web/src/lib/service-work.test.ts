import { rubles } from "@impuls/core";
import { describe, expect, it } from "vitest";
import type { HistoryItem } from "./history-view";
import type { DayReviewModel } from "./insights-model";
import { buildServiceWork } from "./service-work";

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

const build = (history: HistoryItem[], reviews: DayReviewModel[] = [review]) =>
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
    changes: [],
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
