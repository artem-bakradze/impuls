import { reconcile } from "@impuls/worker";
import type { ExecutionResult, SimulationDriver } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { describeDiff } from "../../../apps/web/src/lib/history-view";
import { cursorBeforeCabinetChange, salon, salonNames, trafficOf } from "./analyst-world";
import { featurePath } from "./world";

const feature = await loadFeature(featurePath("platform-integration/traffic-settings.feature"), { language: "ru" });

const user = (sim: SimulationDriver, command: Parameters<SimulationDriver["executor"]["execute"]>[0]["command"]): Promise<ExecutionResult> =>
  sim.executor.execute({ businessId: "b1", command, actor: "user", reasonCode: "USER_CHANGE", explanation: "Вы изменили настройки рекламы" });

describeFeature(feature, ({ Scenario }) => {
  Scenario("Минус-фраза дошла до Директа", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    Given("у рекламы в поиске уже есть минус-фраза «вакансии»", async () => {
      sim = await salon({ days: 1 });
      expect(await user(sim, { type: "AddNegativeKeywords", directionId: "b1-d1", phrases: ["вакансии"] })).toMatchObject({ status: "applied" });
    });
    When("исполнитель применяет команду добавить минус-фразу «бесплатно»", async () => {
      expect(await user(sim, { type: "AddNegativeKeywords", directionId: "b1-d1", phrases: ["бесплатно"] })).toMatchObject({ status: "applied" });
    });
    Then("список минус-фраз кампании в Директе содержит «бесплатно» вместе с «вакансии»", async () => {
      expect((await trafficOf(sim)).negativeKeywords).toEqual(["вакансии", "бесплатно"]);
    });
    And("запись истории хранит список до и после", async () => {
      const entry = (await sim.store.changes("b1")).filter((c) => c.action.type === "AddNegativeKeywords").at(-1);
      expect(entry).toMatchObject({ before: { negativeKeywords: '["вакансии"]' }, after: { negativeKeywords: '["бесплатно","вакансии"]' } });
    });
  });

  Scenario("Корректировка изменена в кабинете", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    Given("корректировка для телефонов −25%, и владелец сам поменял её на 0% в кабинете Директа", async () => {
      sim = await salon({ days: 1 });
      expect(await user(sim, { type: "SetDeviceAdjustment", directionId: "b1-d1", device: "mobile", percent: -25 })).toMatchObject({ status: "applied" });
      sim.platform.cabinetEditCampaign((await sim.store.directions("b1"))[0]?.platformCampaignId ?? "", { deviceAdjustments: { mobile: 0, desktop: 0 } });
    });
    When("проходит сверка с кабинетом", async () => {
      await cursorBeforeCabinetChange(sim);
      await reconcile(sim.ctx, "b1");
    });
    Then("в истории появляется запись автора «Изменено в кабинете Директа» с «было −25% → стало 0%»", async () => {
      const entry = (await sim.store.changes("b1")).filter((c) => c.author === "cabinet").at(-1);
      if (!entry) throw new Error("no cabinet entry");
      expect(describeDiff(entry.before, entry.after, salonNames)).toEqual([{ label: "Цена перехода с телефонов", before: "−25%", after: "0%" }]);
    });
    And("следующая команда проверяет ожидаемое состояние по новому значению", async () => {
      expect(await user(sim, { type: "SetDeviceAdjustment", directionId: "b1-d1", device: "mobile", percent: -10 })).toMatchObject({ status: "applied" });
      const entry = (await sim.store.changes("b1")).at(-1);
      expect(entry).toMatchObject({ before: { mobileAdjustment: 0 }, after: { mobileAdjustment: -10 } });
    });
  });

  Scenario("Разрез совпадает с дневной статистикой", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    let campaignId = "";
    let rows: Awaited<ReturnType<SimulationDriver["platform"]["getBreakdown"]>> = [];
    Given("реклама работает 14 дней", async () => {
      sim = await salon();
      campaignId = (await sim.store.directions("b1"))[0]?.platformCampaignId ?? "";
    });
    When("сервис получает разрез по устройствам за эти дни", async () => {
      rows = await sim.platform.getBreakdown([campaignId], "2026-10-01", "2026-10-14", "device");
    });
    Then("сумма расходов и обращений по строкам разреза совпадает с дневной статистикой кампании", async () => {
      const daily = await sim.platform.getStats([campaignId], "2026-10-01", "2026-10-14");
      const total = (list: readonly { spend: number; leads: number }[]) => list.reduce((s, r) => ({ spend: s.spend + r.spend, leads: s.leads + r.leads }), { spend: 0, leads: 0 });
      const byRows = total(rows);
      const byDays = total(daily);
      expect(Math.abs(byRows.spend - byDays.spend)).toBeLessThanOrEqual(100 * rows.length);
      expect(byRows.leads).toBe(byDays.leads);
    });
  });
});
