import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import type { InsightRecord } from "@impuls/worker";
import { actualActionText, rollbackDiffText } from "../../../apps/web/src/lib/history-view";
import { factLabelForAge, toInsightCard } from "../../../apps/web/src/lib/insights-model";
import { measurementFromCard, measurementState, measurementText } from "../../../apps/web/src/lib/measurement";
import { featurePath } from "./world";

const analyticsFeature = await loadFeature(featurePath("analytics/clarity.feature"), { language: "ru" });
const insightsFeature = await loadFeature(featurePath("insights/clarity.feature"), { language: "ru" });

describeFeature(analyticsFeature, ({ Scenario }) => {
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
