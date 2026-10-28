import { rubles } from "@impuls/core";
import { rollback } from "@impuls/worker";
import type { RollbackResult, SimulationDriver } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { featurePath, launchedWorld } from "./world";

const feature = await loadFeature(featurePath("change-history/rollback.feature"), { language: "ru" });

describeFeature(feature, ({ Scenario }) => {
  Scenario("Откат паузы", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let entryId = "";
    let adId = "";
    Given("сервис отключил объявление без обращений страховочным правилом", async () => {
      sim = await launchedWorld(30_000);
      await sim.runDays(14);
      const entry = (await sim.store.changes("b1")).find((c) => c.reasonCode === "SAFETY_PAUSE_AD");
      entryId = entry?.id ?? "";
      adId = entry?.objectId ?? "";
      expect(entryId).not.toBe("");
    });
    When("пользователь нажимает «Вернуть как было» у этой записи", async () => {
      expect((await rollback(sim.ctx, { businessId: "b1", entryId })).kind).toBe("done");
    });
    Then("объявление снова активно", async () => {
      expect((await sim.store.ads("b1")).find((a) => a.id === adId)?.status).toBe("active");
    });
    And("исходная запись помечена отменённой, а в истории появилась запись об отмене", async () => {
      const changes = await sim.store.changes("b1");
      expect(changes.find((c) => c.id === entryId)?.revertedById).not.toBeNull();
      expect(changes.some((c) => c.reasonCode === "USER_ROLLBACK" && c.author === "user")).toBe(true);
    });
    And("через 3 дня сервис не отключает это объявление снова", async () => {
      await sim.runDays(3);
      expect((await sim.store.ads("b1")).find((a) => a.id === adId)?.status).toBe("active");
    });
  });

  Scenario("После изменения были более поздние изменения того же объекта", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let firstId = "";
    let result: RollbackResult | null = null;
    Given("пользователь дважды поменял лимит одного направления", async () => {
      sim = await launchedWorld(30_000);
      for (const rub of [1_500, 1_000]) {
        await sim.executor.execute({
          businessId: "b1",
          command: { type: "SetSpendLimit", directionId: "b1-d1", weeklyLimit: rubles(rub) },
          actor: "user",
          reasonCode: "USER_LIMIT",
          explanation: "Вы изменили лимит",
        });
      }
      firstId = (await sim.store.changes("b1"))[0]?.id ?? "";
    });
    When("он откатывает первое изменение", async () => {
      result = await rollback(sim.ctx, { businessId: "b1", entryId: firstId });
    });
    Then("сервис показывает более позднее изменение и предлагает откатить их вместе", () => {
      expect(result?.kind).toBe("needs_chain");
    });
    And("после согласия лимит возвращается к исходному", async () => {
      expect((await rollback(sim.ctx, { businessId: "b1", entryId: firstId, includeLater: true })).kind).toBe("done");
      expect((await sim.store.directions("b1")).find((d) => d.id === "b1-d1")?.weeklyLimit).toBe(rubles(2_000));
    });
  });

  Scenario("Необратимое изменение", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    let result: RollbackResult | null = null;
    Given("сервис запустил проверку объявления", async () => {
      sim = await launchedWorld(30_000);
      await sim.executor.execute({
        businessId: "b1",
        command: { type: "StartExperiment", directionId: "b1-d1", adId: "b1-d1-a1", hypothesis: "Проверяем оффер" },
        actor: "safety_net",
        reasonCode: "SAFETY_START_EXPERIMENT",
        explanation: "Запустил проверку",
      });
    });
    When("пользователь пытается откатить запуск проверки", async () => {
      result = await rollback(sim.ctx, { businessId: "b1", entryId: (await sim.store.changes("b1"))[0]?.id ?? "" });
    });
    Then("отката нет, и сервис объясняет почему", () => {
      expect(result).toMatchObject({ kind: "not_reversible" });
      expect(result?.kind === "not_reversible" ? result.reason : "").toContain("проверку нельзя отменить");
    });
  });
});
