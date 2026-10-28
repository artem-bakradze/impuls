import { allowedWeeklyTotal, monthBudget, rubles } from "@impuls/core";
import { loadBusinessView } from "@impuls/worker";
import type { ExecutionResult, SimulationDriver } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { campaignIds, featurePath, launchedWorld } from "./world";

const feature = await loadFeature(featurePath("budget-guard/budget.feature"), { language: "ru" });

describeFeature(feature, ({ Scenario }) => {
  Scenario("Запуск в середине месяца", ({ Given, When, Then, And }) => {
    const budgetRub = 15_000;
    let launchedOn = "";
    Given("пользователь с бюджетом 15 000 ₽ в месяц", () => undefined);
    When("он запускает рекламу 25 октября", () => {
      launchedOn = "2026-10-25";
    });
    Then("бюджет октября равен 3 387 ₽", () => {
      expect(monthBudget(budgetRub, launchedOn, "2026-10-31")).toBe(rubles(3_387));
    });
    And("бюджет ноября равен 15 000 ₽", () => {
      expect(monthBudget(budgetRub, launchedOn, "2026-11-01")).toBe(rubles(15_000));
    });
  });

  Scenario("Сервис недоступен двое суток", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    Given("запущенная реклама с бюджетом 9 000 ₽ в месяц", async () => {
      sim = await launchedWorld(9_000);
    });
    When("воркеры сервиса не работают 48 часов в середине месяца", async () => {
      const start = new Date("2026-10-14T00:00:00Z").getTime();
      await sim.runDays(31, { workerDown: (at) => at.getTime() >= start && at.getTime() < start + 48 * 3_600_000 });
    });
    Then("расходы за месяц не превышают бюджет", async () => {
      expect(sim.platform.trueSpend(await campaignIds(sim), "2026-10-01", "2026-10-31")).toBeLessThanOrEqual(rubles(9_000));
    });
  });

  Scenario("Лимит подняли в кабинете Директа", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let campaignId = "";
    Given("запущенная реклама с бюджетом 9 000 ₽ в месяц", async () => {
      sim = await launchedWorld(9_000);
      await sim.runDays(5);
    });
    When("пользователь поднимает в кабинете Директа недельный лимит кампании до 10 000 ₽", async () => {
      campaignId = (await campaignIds(sim))[0] ?? "";
      sim.platform.cabinetEditCampaign(campaignId, { weeklyLimit: rubles(10_000) });
    });
    And("проходит один час", async () => {
      await sim.runHours(1);
    });
    Then("лимит кампании снижен до допустимого предела", async () => {
      const [campaign] = await sim.platform.getCampaigns([campaignId]);
      const view = await loadBusinessView(sim.store, "b1", sim.clock, sim.platform.capabilities());
      const total = view.directions.filter((d) => d.status === "active").reduce((sum, d) => sum + d.weeklyLimit, 0);
      expect(campaign?.weeklyLimit).toBeLessThan(rubles(10_000));
      expect(total).toBeLessThanOrEqual(allowedWeeklyTotal(view.spentMonth, view.monthBudget, view.today));
    });
    And("в истории есть изменение с автором «Изменено в кабинете Директа»", async () => {
      const changes = await sim.store.changes("b1");
      expect(changes.some((c) => c.author === "cabinet" && c.after.weeklyLimit === rubles(10_000))).toBe(true);
    });
    And("в истории объяснено, что лимит снижен, чтобы не выйти за бюджет", async () => {
      const changes = await sim.store.changes("b1");
      expect(changes.some((c) => c.reasonCode === "CABINET_LIMIT_CLAMP" && c.explanation.includes("чтобы не выйти за ваш бюджет"))).toBe(true);
    });
  });

  Scenario("Одновременные действия", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let results: ExecutionResult[] = [];
    Given("запущенная реклама с бюджетом 30 000 ₽ в месяц", async () => {
      sim = await launchedWorld(30_000);
    });
    When("два действия одновременно повышают лимиты двух направлений до 3 300 ₽, и каждое по отдельности допустимо", async () => {
      // 1 October: allowed total = 27 000 ₽ / 5 weeks = 5 400 ₽; each raise alone fits, both together do not.
      const raise = (directionId: string) =>
        sim.executor.execute({
          businessId: "b1",
          command: { type: "SetSpendLimit", directionId, weeklyLimit: rubles(3_300) },
          actor: "user",
          reasonCode: "USER_LIMIT",
          explanation: "Вы изменили лимит",
        });
      results = await Promise.all([raise("b1-d1"), raise("b1-d2")]);
    });
    Then("одно действие выполнено, а второе урезано с учётом первого", () => {
      expect(results.map((r) => r.status).sort()).toEqual(["applied", "clamped"]);
    });
    And("сумма лимитов не выходит за допустимую", async () => {
      const view = await loadBusinessView(sim.store, "b1", sim.clock, sim.platform.capabilities());
      const total = view.directions.reduce((sum, d) => sum + d.weeklyLimit, 0);
      expect(total).toBeLessThanOrEqual(allowedWeeklyTotal(view.spentMonth, view.monthBudget, view.today));
    });
  });
});
