import type { SimulationDriver } from "@impuls/worker";
import { emailKinds } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { featurePath, launchedWorld } from "./world";

const feature = await loadFeature(featurePath("platform-integration/site-monitoring.feature"), { language: "ru" });

const MESSAGE = "Ваш сайт не открывается — показы приостановлены, чтобы не тратить деньги впустую.";

describeFeature(feature, ({ Scenario }) => {
  let sim: SimulationDriver;

  Scenario("Посадочная страница не открывается", ({ Given, When, And, Then }) => {
    Given("запущенная реклама с бюджетом 30 000 ₽ в месяц", async () => {
      sim = await launchedWorld(30_000);
    });
    When("Директ приостанавливает показы, потому что сайт не открывается", async () => {
      const [direction] = await sim.store.directions("b1");
      sim.platform.stopAdsBySiteMonitoring(direction?.platformCampaignId ?? "");
    });
    And("проходит один час", async () => {
      await sim.runHours(1);
    });
    Then("на сводке есть сообщение «Ваш сайт не открывается — показы приостановлены, чтобы не тратить деньги впустую»", async () => {
      const notification = (await sim.store.notifications("b1")).find((n) => n.kind === "site_unavailable");
      expect(notification?.message).toBe(MESSAGE);
    });
    And("письмо об этом не отправляется", () => {
      expect(emailKinds()).not.toContain("site_unavailable");
    });
  });
});
