import { rubles } from "@impuls/core";
import type { CsoSource } from "@impuls/core";
import { handleWebJob, inverseCommands } from "@impuls/worker";
import type { SimulationDriver } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { featurePath, launchedWorld } from "./world";

const feature = await loadFeature(featurePath("campaign-settings/goal.feature"), { language: "ru" });

/** What the settings page sends: a command job through the executor (history, rollback). */
const setGoal = (sim: SimulationDriver, source: CsoSource, explanation: string) =>
  handleWebJob(sim.ctx, { kind: "command", businessId: "b1", command: { type: "SetGoal", source }, explanation });

const lastGoalEntry = async (sim: SimulationDriver) => (await sim.store.changes("b1")).filter((c) => c.action.type === "SetGoal").at(-1);

describeFeature(feature, ({ Scenario }) => {
  Scenario("Своя цена обращения", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    Given("цель подбирается автоматически", async () => {
      sim = await launchedWorld(30_000, { agentEnabled: false });
      const business = await sim.store.getBusiness("b1");
      await sim.store.saveBusiness({ ...business, csoSource: { kind: "auto", reference: rubles(700) } });
    });
    When("пользователь в разделе «Бюджет и цель» указывает 500 ₽", async () => {
      await setGoal(sim, { kind: "user", goal: rubles(500) }, "Вы изменили цель: было «подбирать автоматически», стало «до 500 ₽ за обращение».");
    });
    Then("цель становится 500 ₽, а автоматический подбор выключается", async () => {
      expect((await sim.store.getBusiness("b1")).csoSource).toEqual({ kind: "user", goal: rubles(500) });
    });
    And("в истории появляется запись с кнопкой отката", async () => {
      const entry = await lastGoalEntry(sim);
      expect(entry).toMatchObject({ author: "user", objectKind: "goal", status: "applied" });
      expect(entry ? inverseCommands(entry) : null).toEqual([{ type: "SetGoal", source: { kind: "auto", reference: rubles(700) } }]);
    });
  });

  Scenario("Возврат к автоматическому подбору", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    Given("у пользователя своя цель 500 ₽", async () => {
      sim = await launchedWorld(30_000, { agentEnabled: false });
      const business = await sim.store.getBusiness("b1");
      await sim.store.saveBusiness({ ...business, csoSource: { kind: "user", goal: rubles(500) } });
    });
    When("он выбирает «Подбирайте сами»", async () => {
      await setGoal(sim, { kind: "auto", reference: rubles(700) }, "Вы изменили цель: было «до 500 ₽ за обращение», стало «подбирать автоматически».");
    });
    Then("цель снова подбирается автоматически", async () => {
      expect((await sim.store.getBusiness("b1")).csoSource).toEqual({ kind: "auto", reference: rubles(700) });
    });
    And("это записано в истории", async () => {
      expect(await lastGoalEntry(sim)).toMatchObject({ explanation: "Вы изменили цель: было «до 500 ₽ за обращение», стало «подбирать автоматически».", status: "applied" });
    });
  });
});
