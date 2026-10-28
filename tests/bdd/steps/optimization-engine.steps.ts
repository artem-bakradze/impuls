import { ReplayPolicy } from "@impuls/agent";
import type { ToolResult } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { runAgentTurn } from "@impuls/worker";
import type { SimulationDriver } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { featurePath, goodTruth, launchedWorld } from "./world";

const feature = await loadFeature(featurePath("optimization-engine/guards.feature"), { language: "ru" });

const justification = { reasonCode: "AGENT_SCALE", text: "Направление приводит клиентов дешевле цели, поэтому выделил ему больше денег." };

/** Warms up a business with cheap leads; automation is off so the safety net does not touch limits first. */
const cheapLeadsWorld = async (): Promise<SimulationDriver> => {
  const sim = await launchedWorld(30_000, { withBadAd: false });
  await sim.launchBusiness({
    id: "b2",
    monthlyBudgetRub: 10_000,
    launchedOn: "2026-10-01",
    csoSource: { kind: "user", goal: rubles(800) },
    directions: [{ name: "Йога — Поиск", weeklyLimitRub: 1_000, ads: [{ title: "Йога утром", truth: goodTruth }] }],
  });
  await sim.store.setFlag("automation_enabled", false, null);
  await sim.store.setFlag("agent_enabled", false, null);
  await sim.runDays(8);
  await sim.store.setFlag("agent_enabled", true, null);
  return sim;
};

const replayTurn = async (sim: SimulationDriver, calls: ConstructorParameters<typeof ReplayPolicy>[0][number]["calls"]): Promise<ToolResult[]> => {
  const agent = new ReplayPolicy([{ trigger: { kind: "daily_review" }, calls }]);
  await runAgentTurn({ ...sim.ctx, agent }, "b1", { kind: "daily_review" });
  const turns = await sim.store.turns("b1");
  const last = turns[turns.length - 1];
  return (last?.calls as { result: ToolResult }[]).map((c) => c.result);
};

describeFeature(feature, ({ Scenario }) => {
  Scenario("Агент не отключил плохое объявление", ({ Given, And, When, Then }) => {
    let sim: SimulationDriver;
    Given("запущенная реклама, где одно объявление тратит деньги без обращений", async () => {
      sim = await launchedWorld(30_000);
    });
    And("агент ничего не делает", () => undefined);
    When("проходит 14 дней", async () => {
      await sim.runDays(14);
    });
    Then("объявление без обращений отключено страховочным правилом", async () => {
      const ad = (await sim.store.ads("b1")).find((a) => a.title === "Маникюр без записи");
      expect(ad?.status).toBe("paused");
      expect((await sim.store.changes("b1")).some((c) => c.objectId === ad?.id && c.actor === "safety_net")).toBe(true);
    });
  });

  Scenario("Два повышения в одном ходе", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let results: ToolResult[] = [];
    Given("направление, которое приводит обращения дешевле цели", async () => {
      sim = await cheapLeadsWorld();
    });
    When("агент в одном ходе дважды повышает лимит этого направления на 20%", async () => {
      const direction = (await sim.store.directions("b1")).find((d) => d.id === "b1-d1");
      const first = Math.floor((direction?.weeklyLimit ?? 0) * 1.2);
      results = await replayTurn(sim, [
        { command: { type: "SetSpendLimit", directionId: "b1-d1", weeklyLimit: first }, justification },
        { command: { type: "SetSpendLimit", directionId: "b1-d1", weeklyLimit: Math.floor(first * 1.2) }, justification },
      ]);
    });
    Then("первое повышение выполнено", () => {
      expect(results[0]?.status).toBe("applied");
    });
    And("второе отклонено с причиной «лимит этого направления можно повышать не чаще раза в 3 дня»", () => {
      expect(results[1]).toMatchObject({ status: "rejected", message: "лимит этого направления можно повышать не чаще раза в 3 дня" });
    });
  });

  Scenario("Объект другого бизнеса", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    let results: ToolResult[] = [];
    Given("направление, которое приводит обращения дешевле цели", async () => {
      sim = await cheapLeadsWorld();
    });
    When("агент пытается отключить объявление другого бизнеса", async () => {
      const foreignAd = (await sim.store.ads("b2"))[0]?.id ?? "";
      results = await replayTurn(sim, [{ command: { type: "PauseAd", adId: foreignAd }, justification: { reasonCode: "AGENT_PAUSE", text: "Отключил объявление." } }]);
    });
    Then("вызов отклонён с причиной «объект не найден»", async () => {
      expect(results[0]).toMatchObject({ status: "rejected", message: "объект не найден" });
      expect((await sim.store.ads("b2"))[0]?.status).toBe("active");
    });
  });

  Scenario("Число в объяснении не совпадает с данными", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    let results: ToolResult[] = [];
    Given("направление, которое приводит обращения дешевле цели", async () => {
      sim = await cheapLeadsWorld();
    });
    When("агент объясняет действие числом, которого нет в данных", async () => {
      results = await replayTurn(sim, [
        {
          command: { type: "PauseAd", adId: "b1-d1-a2" },
          justification: { reasonCode: "AGENT_PAUSE", text: "Отключил объявление: оно потратило 123 457 ₽ без обращений." },
        },
      ]);
    });
    Then("вызов отклонён, и в причине названо неверное число", () => {
      expect(results[0]).toMatchObject({ status: "rejected", code: "EXPLANATION_INVALID" });
      expect(results[0]?.message).toContain("123 457 ₽");
    });
  });
});
