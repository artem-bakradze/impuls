import { describe, expect, it } from "vitest";
import { actualActionText, describeDiff, foldBudgetAdjustments, newestFirst, objectName } from "./history-view";
import type { HistoryItem, Names } from "./history-view";

const plain = (text: string) => text.replace(/[  ]/g, " ");
const names: Names = { directions: { d1: "Маникюр — Поиск" }, channels: { d1: "search" }, ads: { a1: "Маникюр у метро" }, strategies: { WB_MAXIMUM_CLICKS: "Максимум кликов" } };

const item = (id: string, author: HistoryItem["author"], at: string): HistoryItem => ({
  id,
  at,
  author,
  object: "Вся реклама",
  diff: [],
  explanation: id,
  outcome: null,
  turnId: null,
  insight: null,
  status: "applied",
  reverted: false,
  rollback: { kind: "available", consequences: [] },
  budgetAdjustment: false,
});

/** A budget-guard limit cut of «Реклама в поиске» from `from` to `to` rubles a week. */
const cut = (id: string, at: string, from: string, to: string): HistoryItem => ({
  ...item(id, "service", at),
  object: "Реклама в поиске",
  diff: [{ label: "Лимит расходов", before: `${from} ₽ в неделю`, after: `${to} ₽ в неделю` }],
  rollback: { kind: "unavailable", reason: "Лимит пересчитывается сам по остатку бюджета." },
  budgetAdjustment: true,
});

describe("history view", () => {
  it("describes device settings as percentages rather than a zero ruble price", () => {
    const action = { type: "SetDeviceAdjustment" as const, directionId: "d1", device: "mobile" as const, percent: -20 };
    expect(actualActionText({ action, status: "applied", before: { mobileAdjustment: 0 }, after: { mobileAdjustment: -20 } })).toBe("Настройка цены для телефонов: снижение на 20%");
    expect(actualActionText({ action, status: "applied", before: { mobileAdjustment: -20 }, after: { mobileAdjustment: 0 } })).toBe("Настройка цены для телефонов: без повышения или снижения");
  });
  it("shows a business card change as services and prices, not JSON", () => {
    const before = { category: "Маникюр", services: JSON.stringify([{ name: "Маникюр с покрытием", priceRub: null }]), advantages: "[]" };
    const after = { ...before, services: JSON.stringify([{ name: "Маникюр с покрытием", priceRub: 1_800 }]) };
    const rows = describeDiff(before, after, names).map((r) => ({ ...r, after: r.after.replace(/[  ]/g, " ") }));
    expect(rows).toEqual([{ label: "Услуги", before: "Маникюр с покрытием", after: "Маникюр с покрытием — 1 800 ₽" }]);
    expect(objectName("card", "b1", names)).toBe("Описание бизнеса");
  });

  it("shows «было → стало» only for changed fields, in plain words", () => {
    const rows = describeDiff({ status: "active", weeklyLimit: 150_000, schedule: "Пн–Вс 10:00–20:00" }, { status: "active", weeklyLimit: 150_000, schedule: "Пн–Вс 10:00–21:00" }, names);
    expect(rows).toEqual([{ label: "Время показа", before: "Пн–Вс 10:00–20:00", after: "Пн–Вс 10:00–21:00" }]);
    expect(describeDiff({ city: "Москва" }, { city: "Химки" }, names)).toEqual([{ label: "Город показа", before: "Москва", after: "Химки" }]);
    expect(describeDiff({ status: "active" }, { status: "paused" }, names)[0]).toMatchObject({ before: "работает", after: "на паузе" });
    expect(plain(describeDiff({ weeklyLimit: 150_000 }, { weeklyLimit: 100_000 }, names)[0]?.after ?? "")).toBe("1 000 ₽ в неделю");
  });

  it("shows negative phrases and device adjustments in plain words (add-agent-analyst-stage1)", () => {
    const base = { status: "active", weeklyLimit: 150_000, strategyId: "WB_MAXIMUM_CLICKS", mobileAdjustment: 0, desktopAdjustment: 0 };
    expect(describeDiff({ ...base, negativeKeywords: "[]" }, { ...base, negativeKeywords: '["бесплатно"]' }, names)).toEqual([
      { label: "Фразы-исключения", before: "нет", after: "«бесплатно»" },
    ]);
    expect(describeDiff({ ...base, negativeKeywords: '["вакансии"]' }, { ...base, negativeKeywords: '["бесплатно","вакансии"]' }, names)[0]).toMatchObject({
      before: "«вакансии»",
      after: "«бесплатно»; «вакансии»",
    });
    expect(describeDiff({ ...base, negativeKeywords: "[]" }, { ...base, negativeKeywords: "[]", mobileAdjustment: -25 }, names)).toEqual([
      { label: "Настройка цены для телефонов", before: "0%", after: "−25%" },
    ]);
    expect(describeDiff({ desktopAdjustment: 0 }, { desktopAdjustment: 20 }, names)).toEqual([{ label: "Настройка цены для компьютеров и планшетов", before: "0%", after: "+20%" }]);
  });

  it("names advertising by its channel, without the internal word «направление»", () => {
    expect(describeDiff({ d1: "active" }, { d1: "paused" }, names)).toEqual([{ label: "Реклама в поиске", before: "работает", after: "на паузе" }]);
    expect(objectName("direction", "d1", names)).toBe("Реклама в поиске");
    expect(objectName("direction", "d2", { ...names, directions: { d2: "Маникюр — Сайты-партнёры" }, channels: { d2: "network" } })).toBe("Реклама на сайтах-партнёрах");
    expect(objectName("ad", "a1", names)).toBe("Объявление «Маникюр у метро»");
  });

  it("folds a day of budget-guard limit cuts into one row with how each limit moved", () => {
    const feed = newestFirst([
      cut("c1", "2026-11-01T07:25:00Z", "1 350", "1 334"),
      item("scale", "service", "2026-11-01T09:00:00Z"),
      cut("c2", "2026-11-01T10:25:00Z", "1 334", "1 323"),
      cut("c3", "2026-11-01T12:25:00Z", "1 323", "1 312"),
      cut("next-day", "2026-11-02T07:25:00Z", "1 312", "1 300"),
    ]);
    const rows = foldBudgetAdjustments(feed, "Europe/Moscow");
    // A day with one cut shows it as is; the day with three becomes one row where its newest cut was.
    expect(rows.map((r) => (r.kind === "entry" ? r.item.id : r.group.id))).toEqual(["next-day", "budget-2026-11-01", "scale"]);
    const group = rows[1]?.kind === "budget" ? rows[1].group : null;
    expect(group?.entries.map((e) => e.id)).toEqual(["c3", "c2", "c1"]);
    expect(group?.limits).toEqual([{ object: "Реклама в поиске", from: "1 350 ₽ в неделю", to: "1 312 ₽ в неделю" }]);
  });

  it("describes a goal change in plain words", () => {
    const rows = describeDiff({ csoMode: "auto", csoValue: 70_000 }, { csoMode: "user", csoValue: 50_000 }, names);
    expect(rows.map((r) => plain(`${r.label}: ${r.before} → ${r.after}`))).toEqual(["Цена обращения: подбираем сами → своя сумма", "Цель: до 700 ₽ за обращение → до 500 ₽ за обращение"]);
    expect(objectName("goal", "b1", names)).toBe("Цель по цене обращения");
  });

  it("shows every change in one feed, newest first", () => {
    const items = [item("old", "service", "2026-10-01T10:00:00Z"), item("mine", "user", "2026-10-02T10:00:00Z"), item("new", "service", "2026-10-03T10:00:00Z")];
    expect(newestFirst(items).map((i) => i.id)).toEqual(["new", "mine", "old"]);
  });
});
