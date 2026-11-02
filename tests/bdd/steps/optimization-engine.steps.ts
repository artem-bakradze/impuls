import { QuietPolicy, ReplayPolicy } from "@impuls/agent";
import type { AgentRuntime, ToolResult, TurnResult } from "@impuls/agent";
import { factKey, rubles } from "@impuls/core";
import type { InsightDraft } from "@impuls/core";
import { ACTION_META, RULES_DAY_CODE, runAgentTurn } from "@impuls/worker";
import type { SimulationDriver } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { featurePath, goodTruth, launchedWorld } from "./world";

const feature = await loadFeature(featurePath("optimization-engine/guards.feature"), { language: "ru" });

/** The agent's insight: facts every snapshot has, texts without numbers. */
const insight: InsightDraft = {
  reasonCode: "AGENT_SCALE",
  observation: "Направление приводит клиентов дешевле цели, поэтому выделил ему больше денег.",
  factKeys: [factKey.goal(), factKey.budget("budget_left")],
  next: "Через неделю проверим число обращений.",
};

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

/** Every request to the Agents API fails. */
class FailingPolicy implements AgentRuntime {
  readonly name = "policy:failing";
  readonly instructionsVersion = "test";
  readonly decides = true;
  runTurn(): Promise<TurnResult> {
    return Promise.reject(new Error("Agents API unavailable"));
  }
}

/** The rule's pause of «Маникюр без записи», its insight, and whether the day had a turn of the agent. */
const rulePause = async (sim: SimulationDriver) => {
  const ad = (await sim.store.ads("b1")).find((a) => a.title === "Маникюр без записи");
  const change = (await sim.store.changes("b1")).find((c) => c.objectId === ad?.id && c.actor === "safety_net" && c.status === "applied");
  const insights = await sim.store.insights("b1");
  return { ad, change, insight: insights.find((i) => i.id === change?.insightId), insights };
};

describeFeature(feature, ({ Scenario }) => {
  Scenario("Агент не отключил плохое объявление", ({ Given, And, When, Then }) => {
    let sim: SimulationDriver;
    Given("запущенная реклама, где одно объявление тратит деньги без обращений", async () => {
      sim = await launchedWorld(30_000, { agent: new QuietPolicy() });
    });
    And("агент делает ходы, но ничего не меняет", () => undefined);
    When("проходит 14 дней", async () => {
      await sim.runDays(14);
    });
    Then("объявление без обращений отключено страховочным правилом на следующий день после оценки, с инсайтом и кнопкой отката", async () => {
      const { ad, change, insight, insights } = await rulePause(sim);
      expect(ad?.status).toBe("paused");
      expect(insight).toMatchObject({ source: "rule", reasonCode: "SAFETY_PAUSE_AD" });
      expect(change && ACTION_META[change.action.type].reversible).toBe(true);
      // The agent took its turns: no day was left to the rules alone.
      expect(insights.some((i) => i.reasonCode === RULES_DAY_CODE)).toBe(false);
    });
  });

  Scenario("Ход агента не состоялся", ({ Given, And, When, Then }) => {
    let sim: SimulationDriver;
    Given("запущенная реклама, где одно объявление тратит деньги без обращений", async () => {
      sim = await launchedWorld(30_000, { agent: new FailingPolicy() });
    });
    And("Agents API недоступен", () => undefined);
    When("проходит 14 дней", async () => {
      await sim.runDays(14);
    });
    Then("объявление отключено страховочным правилом в тот же день, когда оценка признала его неэффективным, с инсайтом с цифрами", async () => {
      const { change, insight, insights } = await rulePause(sim);
      expect(insight?.facts.map((f) => f.metric)).toEqual(["spend", "leads", "goal"]);
      // Right after the evaluation of that morning, under the day's mark that the rules decided alone.
      const marker = insights.find((i) => i.reasonCode === RULES_DAY_CODE && i.createdAt.getTime() === change?.createdAt.getTime());
      expect(marker?.observation).toBe("Сегодня решения принимали страховочные правила: помощник был недоступен");
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
        { command: { type: "SetSpendLimit", directionId: "b1-d1", weeklyLimit: first }, insight },
        { command: { type: "SetSpendLimit", directionId: "b1-d1", weeklyLimit: Math.floor(first * 1.2) }, insight },
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
      results = await replayTurn(sim, [{ command: { type: "PauseAd", adId: foreignAd }, insight: { ...insight, reasonCode: "AGENT_PAUSE", observation: "Отключил объявление." } }]);
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
          insight: { ...insight, reasonCode: "AGENT_PAUSE", observation: "Отключил объявление: оно потратило 123 457 ₽ без обращений." },
        },
      ]);
    });
    Then("вызов отклонён, и в причине названо неверное число", () => {
      expect(results[0]).toMatchObject({ status: "rejected", code: "INSIGHT_INVALID" });
      expect(results[0]?.message).toContain("123 457 ₽");
    });
  });

  Scenario("День без повода", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let seenAt = 0;
    Given("вчерашний ход видел неэффективное объявление и оставил его", async () => {
      sim = await launchedWorld(30_000, { agent: new QuietPolicy() });
      for (let day = 0; day < 20 && seenAt === 0; day++) {
        await sim.runDays(1);
        const turn = (await sim.store.turns("b1")).find((t) =>
          ((t.context as { trigger?: { reasons?: { kind: string; objectId: string }[] } }).trigger?.reasons ?? []).some((r) => r.kind === "became_ineffective" && r.objectId === "b1-d1-a2"),
        );
        seenAt = turn?.startedAt.getTime() ?? 0;
      }
      expect(seenAt).toBeGreaterThan(0);
    });
    When("сегодня поводов для хода нет", async () => {
      await sim.runDays(1);
    });
    Then("после утренней оценки объявление ставится на паузу страховочным правилом, как после состоявшегося хода", async () => {
      const pause = (await sim.store.changes("b1")).find((c) => c.action.type === "PauseAd" && c.objectId === "b1-d1-a2");
      expect(pause?.actor).toBe("safety_net");
      expect((pause?.createdAt.getTime() ?? 0) - seenAt).toBeGreaterThanOrEqual(23 * 3_600_000);
    });
    And("лента показывает его инсайт, а не «Сегодня решения принимали страховочные правила»", async () => {
      const insights = await sim.store.insights("b1");
      expect(insights.some((i) => i.reasonCode === "SAFETY_PAUSE_AD")).toBe(true);
      expect(insights.filter((i) => i.reasonCode === RULES_DAY_CODE)).toEqual([]);
    });
  });
});
