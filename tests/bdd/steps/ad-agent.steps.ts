import { IdlePolicy } from "@impuls/agent";
import type { AgentRuntime, AgentToolbox, TurnResult, TurnSnapshot } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { enqueueAgentEvent, processAgentInbox, runAgentTurn } from "@impuls/worker";
import type { SimulationDriver, TurnOutcome } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { featurePath, launchedWorld } from "./world";

const feature = await loadFeature(featurePath("ad-agent/turns.feature"), { language: "ru" });

/** Waits inside the turn until released, then tries one action. */
class WaitingPolicy implements AgentRuntime {
  readonly name = "policy:waiting";
  readonly instructionsVersion = "test";
  release: () => void = () => undefined;
  private markStarted: () => void = () => undefined;
  readonly started = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });
  async runTurn(input: { tools: AgentToolbox }): Promise<TurnResult> {
    this.markStarted();
    await new Promise<void>((resolve) => {
      this.release = resolve;
    });
    await input.tools.act({ type: "PauseAd", adId: "b1-d1-a2" }, { reasonCode: "X", text: "Отключил объявление." });
    return { summary: "done", calls: [] };
  }
}

class GoalSpy implements AgentRuntime {
  readonly name = "policy:goal-spy";
  readonly instructionsVersion = "test";
  goal = 0;
  runTurn(input: { snapshot: TurnSnapshot }): Promise<TurnResult> {
    this.goal = input.snapshot.goal.costPerLeadRub;
    return Promise.resolve({ summary: "seen", calls: [] });
  }
}

describeFeature(feature, ({ Scenario }) => {
  Scenario("Несколько отказов модерации подряд", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    Given("запущенная реклама с агентом", async () => {
      sim = await launchedWorld(30_000, { agent: new IdlePolicy() });
    });
    When("за 10 минут Директ отклонил 5 объявлений", async () => {
      for (let i = 0; i < 5; i++) {
        await enqueueAgentEvent(sim.ctx, "b1", { kind: "moderation_rejected", adIds: [`ad-${i}`] });
      }
      await processAgentInbox(sim.ctx, "b1");
    });
    Then("выполняется один ход, в котором агент получает все 5 отказов", async () => {
      const turns = await sim.store.turns("b1");
      expect(turns).toHaveLength(1);
      expect((turns[0]?.context as { trigger: { adIds: string[] } }).trigger.adIds).toHaveLength(5);
    });
  });

  Scenario("Пользователь поменял цель во время хода", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    const waiting = new WaitingPolicy();
    let running: Promise<TurnOutcome>;
    Given("агент выполняет ход", async () => {
      sim = await launchedWorld(30_000, { agent: waiting });
      const business = await sim.store.getBusiness("b1");
      await sim.store.saveBusiness({ ...business, csoSource: { kind: "user", goal: rubles(300) } });
      running = runAgentTurn(sim.ctx, "b1", { kind: "daily_review" });
      await waiting.started;
    });
    When("пользователь меняет цель со 300 ₽ на 450 ₽", async () => {
      const business = await sim.store.getBusiness("b1");
      await sim.store.saveBusiness({ ...business, csoSource: { kind: "user", goal: rubles(450) } });
      await enqueueAgentEvent(sim.ctx, "b1", { kind: "settings_changed" });
      waiting.release();
    });
    Then("текущий ход прерывается", async () => {
      expect(await running).toMatchObject({ status: "cancelled" });
    });
    And("запускается новый ход с целью 450 ₽ в снимке", async () => {
      const spy = new GoalSpy();
      expect((await processAgentInbox({ ...sim.ctx, agent: spy }, "b1")).status).toBe("completed");
      expect(spy.goal).toBe(450);
    });
  });
});
