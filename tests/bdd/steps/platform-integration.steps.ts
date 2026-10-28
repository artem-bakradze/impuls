import type { ExecutionResult, SimulationDriver } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { featurePath, launchedWorld } from "./world";

const feature = await loadFeature(featurePath("platform-integration/reconciliation.feature"), { language: "ru" });

describeFeature(feature, ({ Scenario }) => {
  Scenario("Текст изменён в кабинете", ({ Given, When, And, Then }) => {
    let sim: SimulationDriver;
    let platformAdId = "";
    Given("запущенная реклама с бюджетом 30 000 ₽ в месяц", async () => {
      sim = await launchedWorld(30_000);
      await sim.runHours(2);
    });
    When("пользователь меняет текст объявления в кабинете Директа", async () => {
      platformAdId = (await sim.store.ads("b1"))[0]?.platformAdId ?? "";
      sim.platform.cabinetEditAd(platformAdId, { text: "Маникюр за час у метро" });
    });
    And("проходит один час", async () => {
      await sim.runHours(1);
    });
    Then("сервис принимает новый текст как текущий", async () => {
      expect((await sim.store.ads("b1")).find((a) => a.platformAdId === platformAdId)?.text).toBe("Маникюр за час у метро");
    });
    And("в истории есть изменение текста с «было → стало»", async () => {
      const entry = (await sim.store.changes("b1")).find((c) => c.author === "cabinet" && c.objectKind === "ad");
      expect(entry).toMatchObject({ before: { text: "Маникюр у метро" }, after: { text: "Маникюр за час у метро" } });
      expect(entry?.explanation).toBe("Изменено в кабинете Директа: текст объявления «Маникюр у метро».");
    });
  });

  Scenario("Состояние изменилось перед командой", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    let result: ExecutionResult | null = null;
    Given("запущенная реклама с бюджетом 30 000 ₽ в месяц", async () => {
      sim = await launchedWorld(30_000);
    });
    When("пользователь останавливает объявление в кабинете, а агент сразу пытается его отключить", async () => {
      const ad = (await sim.store.ads("b1"))[0];
      sim.platform.cabinetEditAd(ad?.platformAdId ?? "", { status: "paused" });
      result = await sim.executor.execute({
        businessId: "b1",
        command: { type: "PauseAd", adId: ad?.id ?? "" },
        actor: "agent",
        reasonCode: "AGENT_PAUSE",
        explanation: "Отключил объявление.",
      });
    });
    Then("команда агента отклонена с причиной «состояние объекта изменилось»", () => {
      expect(result).toMatchObject({ status: "rejected", code: "STATE_CHANGED", message: "состояние объекта изменилось" });
    });
  });
});
