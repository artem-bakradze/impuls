import type { ExecutionResult, SimulationDriver } from "@impuls/worker";
import { ACTION_META, handleWebJob, inverseCommands } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { featurePath, launchedWorld } from "./world";

const feature = await loadFeature(featurePath("campaign-settings/card.feature"), { language: "ru" });

const withoutPrice = { category: "Маникюр", services: [{ name: "Маникюр с покрытием", priceRub: null }], advantages: [] };
const withPrice = { ...withoutPrice, services: [{ name: "Маникюр с покрытием", priceRub: 1_800 }] };

const launchedWithCard = async (): Promise<SimulationDriver> => {
  const sim = await launchedWorld(30_000, { agentEnabled: false });
  const business = await sim.store.getBusiness("b1");
  await sim.store.saveBusiness({ ...business, card: { ...business.card, ...withoutPrice } });
  return sim;
};

const adTexts = async (sim: SimulationDriver) => (await sim.store.ads("b1")).map((a) => ({ title: a.title, text: a.text, status: a.status }));

describeFeature(feature, ({ Scenario }) => {
  Scenario("Изменение карточки", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let adsBefore: Awaited<ReturnType<typeof adTexts>>;
    Given("реклама запущена, а у услуги «Маникюр с покрытием» нет цены", async () => {
      sim = await launchedWithCard();
      adsBefore = await adTexts(sim);
    });
    When("пользователь в разделе «Что рекламируем» добавляет цену 1 800 ₽ и сохраняет", async () => {
      // What the settings page sends: a command job through the executor (history, rollback).
      await handleWebJob(sim.ctx, { kind: "command", businessId: "b1", command: { type: "UpdateCard", card: withPrice }, explanation: "Вы изменили описание бизнеса." });
    });
    Then("в описании бизнеса у услуги цена 1 800 ₽", async () => {
      expect((await sim.store.getBusiness("b1")).card.services).toEqual([{ name: "Маникюр с покрытием", priceRub: 1_800 }]);
    });
    And("работающие объявления не изменились", async () => {
      expect(await adTexts(sim)).toEqual(adsBefore);
    });
    And("в истории появляется запись «было → стало» с кнопкой отката", async () => {
      const entry = (await sim.store.changes("b1")).find((c) => c.action.type === "UpdateCard");
      expect(entry).toMatchObject({ author: "user", objectKind: "card", status: "applied" });
      expect(entry?.before.services).not.toBe(entry?.after.services);
      expect(ACTION_META.UpdateCard.reversible).toBe(true);
      expect(entry ? inverseCommands(entry) : null).toEqual([{ type: "UpdateCard", card: withoutPrice }]);
    });
  });

  Scenario("Карточку не меняет автоматика", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    let result: ExecutionResult;
    Given("реклама запущена, а у услуги «Маникюр с покрытием» нет цены", async () => {
      sim = await launchedWithCard();
    });
    When("страховочное правило пытается изменить описание бизнеса", async () => {
      result = await sim.executor.execute({ businessId: "b1", command: { type: "UpdateCard", card: withPrice }, actor: "safety_net", reasonCode: "X", explanation: "Изменил описание" });
    });
    Then("изменение отклонено, и описание осталось прежним", async () => {
      expect(result).toMatchObject({ status: "rejected", code: "NOT_ALLOWED_FOR_AUTOMATION" });
      expect((await sim.store.getBusiness("b1")).card.services).toEqual(withoutPrice.services);
    });
  });
});
