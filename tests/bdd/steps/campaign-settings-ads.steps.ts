import { handleWebJob, inverseCommands } from "@impuls/worker";
import type { SimulationDriver } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { featurePath, launchedWorld } from "./world";

const feature = await loadFeature(featurePath("campaign-settings/ads.feature"), { language: "ru" });

describeFeature(feature, ({ Scenario }) => {
  Scenario("Отключение объявления с карточки", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let adId = "";
    Given("реклама запущена, и у рекламы в поиске несколько объявлений", async () => {
      sim = await launchedWorld(30_000, { agentEnabled: false });
      const search = (await sim.store.directions("b1")).find((d) => d.channel === "search");
      const ads = (await sim.store.ads("b1")).filter((a) => a.directionId === search?.id && a.status === "active");
      expect(ads.length).toBeGreaterThan(1);
      adId = ads[0]?.id ?? "";
    });
    When("пользователь нажимает «Отключить» у одного объявления", async () => {
      // What the ad card sends: the same command job as before, through the executor.
      await handleWebJob(sim.ctx, { kind: "command", businessId: "b1", command: { type: "PauseAd", adId }, explanation: "Вы отключили объявление." });
    });
    Then("объявление остановлено", async () => {
      expect((await sim.store.ads("b1")).find((a) => a.id === adId)?.status).toBe("paused");
    });
    And("в журнале появляется строка «Вы: отключили объявление» с кнопкой «Вернуть как было»", async () => {
      const entry = (await sim.store.changes("b1")).filter((c) => c.action.type === "PauseAd").at(-1);
      expect(entry).toMatchObject({ author: "user", objectKind: "ad", objectId: adId, status: "applied" });
      // The journal names it in the owner's words and the entry rolls back (insights «Правка владельца в журнале»).
      expect(entry ? inverseCommands(entry) : null).toEqual([{ type: "ResumeAd", adId }]);
    });
  });
});
