import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect, vi } from "vitest";
import type { InsightRecord } from "@impuls/worker";
import { handleWebJob } from "@impuls/worker";
import type { HistoryItem } from "../../../apps/web/src/lib/history-view";
import { actualActionText, rollbackDiffText } from "../../../apps/web/src/lib/history-view";
import { factLabelForAge, toInsightCard } from "../../../apps/web/src/lib/insights-model";
import { measurementFromCard, measurementState, measurementText } from "../../../apps/web/src/lib/measurement";
import { simulationStatusOf } from "../../../apps/web/src/lib/simulation-model";
import { buildDecisionScreen } from "../../../apps/web/src/lib/simulation-screen";
import { clarityWorld } from "./clarity-world";
import { buildWeekStory } from "../../../apps/web/src/lib/week-story";
import { readWeekReport } from "@impuls/worker/simulation-report";
import { toLocalDate } from "@impuls/core";
import { featurePath } from "./world";

type World = Awaited<ReturnType<typeof clarityWorld>>;
const simulationFeature = await loadFeature(featurePath("simulation-mode/clarity.feature"), { language: "ru" });
const analyticsFeature = await loadFeature(featurePath("analytics/clarity.feature"), { language: "ru" });
const insightsFeature = await loadFeature(featurePath("insights/clarity.feature"), { language: "ru" });

const heldStep = async (w: World) => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const stats = w.driver.store.stats.bind(w.driver.store);
  const spy = vi.spyOn(w.driver.store, "stats").mockImplementationOnce(async (...args) => { started(); await gate; return stats(...args); });
  const pending = w.next();
  await entered;
  return { finish: async () => { release(); await pending; spy.mockRestore(); } };
};

describeFeature(simulationFeature, ({ Scenario }) => {
  Scenario("Ошибочное отсутствие действий не показывается", ({ Given, When, Then }) => {
    let w: World; let story: ReturnType<typeof buildWeekStory>; let actionDays: number;
    Given("во вторую неделю были тихие дни и решения", async () => { w = await clarityWorld(); await w.next(); await w.next(); });
    When("тихие дни сгруппированы вместе с соседними датами", async () => {
      const simulation = await w.record(); const report = simulation.steps[1]?.report;
      if (!report) throw new Error("Expected week report");
      const saved = readWeekReport(report);
      const history = (await w.story(2))?.decisions.map((d) => d.item) ?? [];
      actionDays = new Set(saved.changes.filter((c) => c.status === "applied" && c.author === "service" && (c.actor === "agent" || c.actor === "safety_net")).map((c) => toLocalDate(c.createdAt, w.business.timeZone)).filter((date) => date >= "2026-11-08" && date <= "2026-11-14")).size;
      story = buildWeekStory({ simulation: { ...simulation, steps: simulation.steps.map(({ kind, from, to }) => ({ kind, from, to })) }, week: 2, timeZone: w.business.timeZone, directions: saved.directions, ads: saved.ads, stats: saved.stats, cso: saved.cso, truthOf: () => null, changes: saved.changes, history, comparison: null, reviews: [{ date: "2026-11-15", from: "2026-11-01", summary: null, quiet: true, rulesReason: null, insights: [], weekly: null }] });
    });
    Then("считаются только даты этой недели без дней с действием", () => { expect(actionDays).toBeGreaterThan(0); expect(story?.quietDays).toBe(7 - actionDays); expect(story?.decisions.length).toBeGreaterThan(0); expect(story?.noDecisionReason).toBeNull(); });
  });
  Scenario("Отмена поверх сохранённой недели", ({ Given, When, Then }) => {
    let w: World; let before: Awaited<ReturnType<World["story"]>>; let id: string;
    Given("сервис отключил объявление во вторую неделю", async () => {
      w = await clarityWorld(); await w.next(); await w.next(); before = await w.story(2);
      const pause = before?.decisions.find((d) => d.item.decisionText === "Отключили объявление");
      if (!pause) throw new Error("Expected a saved pause decision"); id = pause.item.id;
    });
    When("владелец возвращает его через историю", async () => { expect(await handleWebJob(w.driver.ctx, { kind: "rollback", businessId: w.business.id, entryId: id })).toMatchObject({ kind: "done" }); });
    Then("цифры недели прежние, а решение помечено отменённым", async () => {
      const saved = (await w.driver.store.changes(w.business.id)).find((c) => c.id === id);
      expect(saved?.revertedById).not.toBeNull();
      const old = before?.decisions.find((d) => d.item.id === id)?.item;
      if (!old) throw new Error("Expected the original decision");
      const overlay: HistoryItem = { ...old, reverted: true, rollback: { kind: "unavailable", reason: "Уже отменено." } };
      const after = await w.story(2, [overlay]); expect(after?.totals).toEqual(before?.totals); expect(after?.decisions.find((d) => d.item.id === id)?.item.reverted).toBe(true);
    });
  });
  Scenario("Переход во время расчёта", ({ Given, When, Then }) => {
    let w: World; let held: Awaited<ReturnType<typeof heldStep>>; let story: Awaited<ReturnType<World["story"]>>;
    Given("первая неделя ещё рассчитывается", async () => { w = await clarityWorld(); held = await heldStep(w); });
    When("владелец открывает историю первой недели", async () => { story = await w.story(); });
    Then("готовых итогов и прожитых недель пока нет", async () => {
      try {
        expect(story).toBeNull();
        expect(simulationStatusOf({ simulation: await w.record(), timeZone: w.business.timeZone, changes: 0, runningTurn: null, turns: [] }).weeks).toBe(0);
      } finally { await held.finish(); }
    });
  });
  Scenario("Новый шаг при доступной прошлой неделе", ({ Given, When, Then }) => {
    let w: World; let held: Awaited<ReturnType<typeof heldStep>>;
    Given("первая неделя завершена", async () => { w = await clarityWorld(); await w.next(); });
    When("начинается расчёт второй недели", async () => { held = await heldStep(w); });
    Then("первая неделя доступна, а вторая ещё не готова", async () => {
      try { expect(await w.story(1)).not.toBeNull(); expect(await w.story(2)).toBeNull(); } finally { await held.finish(); }
    });
  });
  Scenario("Поздняя корректировка отчёта", ({ Given, When, Then }) => {
    let w: World; let before: Awaited<ReturnType<World["story"]>>;
    Given("первая неделя завершена", async () => { w = await clarityWorld(); await w.next(); before = await w.story(); });
    When("текущие расходы и объявления изменились", async () => {
      const stats = await w.driver.store.stats(w.business.id, "2026-11-01", "2026-11-07");
      await w.driver.store.upsertStats(w.business.id, stats.map((r) => ({ ...r, spend: r.spend + 100_000, leads: r.leads + 1 })));
      for (const ad of await w.driver.store.ads(w.business.id)) await w.driver.store.saveAd({ ...ad, title: "Исправленный текст" });
    });
    Then("сохранённый итог первой недели прежний", async () => { expect(await w.story()).toEqual(before); expect(before?.savedAt).toBeDefined(); });
  });
  Scenario("Продолжение прерванной недели", ({ Given, When, Then }) => {
    let w: World; let at: string; let changes: number;
    Given("сохранение результата недели прервалось", async () => {
      w = await clarityWorld();
      const save = w.driver.store.saveSimulation.bind(w.driver.store);
      const spy = vi.spyOn(w.driver.store, "saveSimulation").mockImplementation(async (record) => {
        if (record.steps.at(-1)?.state === "completed") { spy.mockRestore(); throw new Error("Injected report save failure"); }
        await save(record);
      });
      await expect(w.next()).rejects.toThrow("Injected report save failure");
      expect((await w.record()).steps.at(-1)?.state).toBe("failed");
      expect(await w.story()).toBeNull();
      at = (await w.record()).simNow.toISOString(); changes = (await w.driver.store.changes(w.business.id)).length;
    });
    When("владелец явно продолжает расчёт", async () => { await w.next(); });
    Then("завершается одно окно без повторения часов и применённых команд", async () => {
      const saved = await w.record(); expect(saved.steps).toHaveLength(1); expect(saved.steps[0]?.state).toBe("completed");
      expect(saved.simNow.toISOString()).toBe(at); expect((await w.driver.store.changes(w.business.id)).length).toBe(changes); expect(await w.story()).not.toBeNull();
    });
  });
});

describeFeature(analyticsFeature, ({ Scenario }) => {
  Scenario("Получены не все обращения симулятора", ({ Given, When, Then }) => {
    let w: World; let model: ReturnType<typeof buildDecisionScreen>;
    Given("в полном результате 14 обращений, а в отчёте получено 13", async () => { w = await clarityWorld(); await w.next(); });
    When("сравниваются одинаковые завершённые дни", async () => {
      model = buildDecisionScreen({ simulation: await w.record(), timeZone: w.business.timeZone, monthlyBudgetRub: 15000, directions: [], changes: [], fullDaily: [{ date: "2026-11-01", leads: 14, spend: 140000 }], observed: [{ date: "2026-11-01", campaignId: "test", adId: "test", impressions: 100, clicks: 20, leads: 13, spend: 130000 }] });
    });
    Then("показаны оба источника без подмены полученных данных", () => { expect(model.comparison?.serviceNow.leads).toBe(14); expect(model.comparison?.observed?.leads).toBe(13); expect(model.comparison?.to).toBe("2026-11-07"); });
  });
  Scenario("Ожидание первого дня", ({ Given, When, Then }) => {
    let w: World; let model: Awaited<ReturnType<World["screen"]>>;
    Given("учебный бизнес только запущен", async () => { w = await clarityWorld(); });
    When("владелец открывает сравнение", async () => { model = await w.screen(); });
    Then("сравнения с полным днём пока нет", () => { expect(model.comparison).toBeNull(); expect(model.result).toBeNull(); });
  });
  Scenario("Код найден без подтверждённых событий", ({ Given, When, Then }) => {
    let text: ReturnType<typeof measurementText>;
    Given("найден код счётчика", () => undefined);
    When("показывается готовность измерений", () => { text = measurementText(measurementState({ status: "found", counterId: 12345678 })); });
    Then("получение обращений не объявляется подтверждённым", () => { expect(text.title).toContain("12345678"); expect(text.detail).toContain("получение обращений пока не подтверждено"); });
  });
  Scenario("Предупреждение не теряется после запуска", ({ Given, When, Then }) => {
    let card: { siteUrl: string; measurement: { siteUrl: string; status: "unreachable"; counterId: null } }; let text: ReturnType<typeof measurementText>;
    Given("сайт не ответил при проверке", () => { card = { siteUrl: "https://example.test", measurement: { siteUrl: "https://example.test", status: "unreachable", counterId: null } }; });
    When("открываются сводка и настройки запущенного бизнеса", () => { text = measurementText(measurementFromCard(card, false)); });
    Then("оба экрана используют тот же непроверенный статус", () => { expect(text.title).toContain("Не получилось открыть сайт"); expect(text.detail).toContain("Запустить рекламу это не мешает"); expect(measurementFromCard({ ...card, siteUrl: "https://new.test" }, false).status).toBe("unchecked"); });
  });
});

describeFeature(insightsFeature, ({ Scenario }) => {
  Scenario("Увеличение ограничено остатком", ({ Given, When, Then }) => {
    let text: string | undefined;
    Given("недельный лимит был 1347 рублей", () => undefined);
    When("предложение 1493 рубля применено с ограничением до 1492 рублей", () => { text = actualActionText({ action: { type: "SetSpendLimit", directionId: "test", weeklyLimit: 149300 }, before: { weeklyLimit: 134700 }, after: { weeklyLimit: 149200 }, status: "applied" }); });
    Then("краткое действие сообщает об увеличении до 1492 рублей", () => { expect(text?.replace(/\u00a0/g, " ")).toBe("Увеличили недельный лимит до 1 492 ₽"); });
  });
  Scenario("Действие отклонено", ({ Given, When, Then }) => {
    let record: InsightRecord; let card: ReturnType<typeof toInsightCard>;
    Given("предложение сервиса отклонено", () => { record = { id: "i", businessId: "b", turnId: null, source: "rule", reasonCode: "TEST", observation: "Данных недостаточно", facts: [], decision: { kind: "action", text: "Лимит не изменён", status: "rejected", changeIds: [] }, next: "Проверим позже", objectRef: null, createdAt: new Date("2026-11-01T06:00:00Z") }; });
    When("строится карточка решения", () => { card = toInsightCard(record, null, null); });
    Then("карточка явно сообщает, что изменение не применено", () => { expect(card.decision.text).toContain("Изменение не применено"); expect(card.rollback).toBeNull(); });
  });
  Scenario("Бизнес работает меньше окна отчёта", ({ Given, When, Then }) => {
    let label: string;
    Given("бизнес работает 8 дней", () => undefined);
    When("показывается факт в окне 14 дней", () => { label = factLabelForAge({ object: "реклама", metric: "spend", period: "14d" }, 8); });
    Then("подпись различает окно и фактические дни работы", () => { expect(label).toContain("14 дней"); expect(label).toContain("дней работы: 8"); });
  });
  Scenario("Сброс настройки цены для устройств", ({ Given, When, Then }) => {
    let text: string;
    Given("настройка для телефонов уменьшена на 20 процентов", () => undefined);
    When("открываются последствия её отмены", () => { text = rollbackDiffText({ label: "Настройка цены для телефонов", before: "0%", after: "−20%" }); });
    Then("описано снятие снижения, а не бесплатный переход", () => { expect(text).toBe("Уберём снижение цены перехода для телефонов на 20%"); expect(text).not.toMatch(/\b0%/); });
  });
});
