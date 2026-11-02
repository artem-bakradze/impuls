import { rubles } from "@impuls/core";
import { SimulationDriver } from "@impuls/worker";
import type { ExecutionResult, Experiment } from "@impuls/worker";
import { IdlePolicy } from "@impuls/agent";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { featurePath, launchedWorld } from "./world";

const feature = await loadFeature(featurePath("ab-testing/experiments.feature"), { language: "ru" });

/** About 900 ₽ per lead at a goal of 800 ₽: neither cheap enough to be effective nor bad enough to be switched off. */
const borderlineTruth = { impressionsPerDay: 2_000, ctr: 0.06, cr: 0.022, costPerClick: rubles(20) };

const variant = { title: "Маникюр у метро", text: "Первый визит −15%" };

const startExperiment = (sim: SimulationDriver, directionId: string, adId: string): Promise<ExecutionResult> =>
  sim.executor.execute({
    businessId: "b1",
    command: { type: "StartExperiment", directionId, adId, kind: "offer", hypothesis: "Проверяем, приведёт ли скидка на первый визит больше записей", variant },
    actor: "safety_net",
    reasonCode: "SAFETY_START_EXPERIMENT",
    explanation: "Запустил проверку",
  });

describeFeature(feature, ({ Scenario }) => {
  Scenario("Страховочный запуск без агента", ({ Given, And, When, Then }) => {
    let sim: SimulationDriver;
    let borderlineOn = "";
    let experiment: Experiment | undefined;
    Given("реклама работает без агента", async () => {
      sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 7, agent: new IdlePolicy(), agentEnabled: false });
      await sim.launchBusiness({
        id: "b1",
        monthlyBudgetRub: 60_000,
        launchedOn: "2026-10-01",
        csoSource: { kind: "user", goal: rubles(800) },
        directions: [{ name: "Маникюр — Поиск", weeklyLimitRub: 7_000, ads: [{ title: "Маникюр у метро", truth: borderlineTruth }] }],
      });
    });
    And("объявление при ежедневной оценке признано пограничным, а других проверок нет", async () => {
      for (let day = 0; day < 21 && borderlineOn === ""; day++) {
        await sim.runDays(1);
        const evaluation = await sim.store.lastEvaluation("b1");
        if (evaluation?.adClasses.get("b1-d1-a1") === "borderline") {
          borderlineOn = evaluation.on;
        }
      }
      expect(borderlineOn).not.toBe("");
    });
    When("проходит ежедневная оценка", async () => {
      experiment = (await sim.store.experiments("b1"))[0];
    });
    Then("в ту же группу добавлен вариант объявления с одним изменением", async () => {
      expect(experiment).toMatchObject({ adId: "b1-d1-a1", startedOn: borderlineOn, status: "running" });
      const ads = await sim.store.ads("b1");
      const control = ads.find((a) => a.id === "b1-d1-a1");
      const added = ads.find((a) => a.id === experiment?.variantAdId);
      expect(added?.directionId).toBe("b1-d1");
      expect([added?.title === control?.title, added?.text === control?.text].filter(Boolean)).toHaveLength(1);
    });
    And("на сводке в блоке «Сейчас проверяем» видна гипотеза простым языком", () => {
      expect(experiment?.hypothesis).toMatch(/^Проверяем/);
    });
    And("в истории есть запись с пометкой «страховочное правило»", async () => {
      const entry = (await sim.store.changes("b1")).find((c) => c.action.type === "StartExperiment");
      expect(entry).toMatchObject({ actor: "safety_net", reasonCode: "SAFETY_START_EXPERIMENT", status: "applied" });
    });
  });

  Scenario("Слот занят", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    let second: ExecutionResult;
    Given("у бизнеса уже идёт проверка", async () => {
      sim = await launchedWorld(30_000, { agentEnabled: false });
      expect((await startExperiment(sim, "b1-d1", "b1-d1-a1")).status).toBe("applied");
    });
    When("ещё одно объявление стало пограничным", async () => {
      second = await startExperiment(sim, "b1-d2", "b1-d2-a1");
    });
    Then("новая проверка не запускается до завершения текущей", async () => {
      expect(second).toMatchObject({ status: "rejected", code: "EXPERIMENT_SLOTS_FULL" });
      expect(await sim.store.experiments("b1")).toHaveLength(1);
    });
  });

  Scenario("Вариант объявления не меняет лимит", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    Given("направление с лимитом 2 000 ₽ в неделю", async () => {
      sim = await launchedWorld(30_000, { agentEnabled: false });
    });
    When("запускается проверка объявления этого направления", async () => {
      expect((await startExperiment(sim, "b1-d1", "b1-d1-a1")).status).toBe("applied");
    });
    Then("второе объявление добавляется в ту же группу", async () => {
      const [experiment] = await sim.store.experiments("b1");
      const ads = (await sim.store.ads("b1")).filter((a) => a.directionId === "b1-d1");
      expect(ads.map((a) => a.id)).toContain(experiment?.variantAdId);
      expect(ads.find((a) => a.id === experiment?.variantAdId)).toMatchObject(variant);
    });
    And("лимит направления остаётся 2 000 ₽ в неделю", async () => {
      expect((await sim.store.directions("b1")).find((d) => d.id === "b1-d1")?.weeklyLimit).toBe(rubles(2_000));
    });
  });
});
