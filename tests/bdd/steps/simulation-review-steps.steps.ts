import type { AgentRuntime, AgentToolbox, TurnResult, TurnSnapshot } from "@impuls/agent";
import { factKey, rubles } from "@impuls/core";
import type { InsightDraft } from "@impuls/core";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { ownerWorld, PLAIN } from "./owner-world";
import type { OwnerWorld } from "./owner-world";
import { featurePath } from "./world";

const feature = await loadFeature(featurePath("simulation-mode/review-steps.feature"), { language: "ru" });

/** An insight on facts every snapshot has; the texts carry no numbers. */
const insight: InsightDraft = { reasonCode: "AGENT", observation: "Реклама в поиске приводит обращения.", factKeys: [factKey.goal(), factKey.budget("budget_left")], next: "Проверю через неделю." };
const WEEK = { impressions: 1_400, clicks: 70, leads: 7, spendRub: 1_500 };

/**
 * A period's assistant that does its steps and stops in the middle of the turn until the test lets it finish: so the
 * test sees the player as the owner does while the review goes.
 */
class PausingAgent implements AgentRuntime {
  readonly name = "policy:pausing";
  readonly instructionsVersion = "test";
  readonly decides = true;
  turns = 0;
  private release: () => void = () => undefined;
  private markPaused: () => void = () => undefined;
  readonly paused = new Promise<void>((resolve) => {
    this.markPaused = resolve;
  });
  constructor(private readonly steps: (tools: AgentToolbox, snapshot: TurnSnapshot) => Promise<void>) {}
  async runTurn(input: { snapshot: TurnSnapshot; tools: AgentToolbox }): Promise<TurnResult> {
    this.turns++;
    await this.steps(input.tools, input.snapshot);
    await new Promise<void>((resolve) => {
      this.release = resolve;
      this.markPaused();
    });
    return { summary: "Посмотрел цифры за эти дни и записал, что проверю дальше.", calls: [], usage: null };
  }
  finish(): void {
    this.release();
  }
}

const searchOf = (snapshot: TurnSnapshot): string => snapshot.directions.find((d) => d.name.endsWith("Поиск"))?.id ?? "";

/** The owner's period sent and running: the review is stopped in the middle until `finish`. */
const startPeriod = async (agent: PausingAgent) => {
  const w = await ownerWorld(agent);
  const running = w.enter(7, { [PLAIN]: WEEK });
  await agent.paused;
  return { w, running };
};

describeFeature(feature, ({ Scenario }) => {
  Scenario("Шаги до готового разбора", ({ Given, When, Then }) => {
    let agent: PausingAgent;
    let w: OwnerWorld;
    let running: Promise<unknown>;
    let seen: string[] = [];
    Given("реклама запущена в симуляции с помощником, который останавливается посреди разбора", () => {
      agent = new PausingAgent(async (tools, snapshot) => {
        await tools.breakdown(searchOf(snapshot), "device");
        await tools.saveHypothesis({ statement: "С телефонов обращения дороже, чем с компьютеров.", factKeys: insight.factKeys, check: "Сравню устройства.", checkOn: snapshot.today, status: "checking" });
      });
    });
    When("владелец отправил период дней 1–7, а помощник посмотрел цифры, сравнил телефоны и компьютеры и записал гипотезу «с телефонов обращения дороже, чем с компьютеров»", async () => {
      ({ w, running } = await startPeriod(agent));
      // What the player reads on its next poll, a second later at most.
      seen = (await w.player()).reviewSteps;
    });
    Then("до готового разбора по порядку видно «Смотрю цифры за дни 1–7», «Смотрю, откуда обращения дешевле — с телефонов или с компьютеров» и «Предполагаю: с телефонов обращения дороже, чем с компьютеров»", async () => {
      expect(seen).toEqual(["Смотрю цифры за дни 1–7", "Смотрю, откуда обращения дешевле — с телефонов или с компьютеров", "Предполагаю: с телефонов обращения дороже, чем с компьютеров"]);
      agent.finish();
      await running;
    });
  });

  Scenario("Отклонённое действие не выдаётся за сделанное", ({ Given, When, Then }) => {
    let agent: PausingAgent;
    let w: OwnerWorld;
    let running: Promise<unknown>;
    let refused = "";
    Given("реклама запущена в симуляции с помощником, который останавливается посреди разбора", () => {
      agent = new PausingAgent(async (tools, snapshot) => {
        // The insight cites a figure that is not in the facts: the service refuses, and the limit stays.
        const result = await tools.act({ type: "SetSpendLimit", directionId: searchOf(snapshot), weeklyLimit: rubles(5_000) }, { ...insight, observation: "Поднял лимит: реклама принесла 123456 ₽." });
        refused = result.status;
      });
    });
    When("помощник пытается поднять недельный лимит, а сервис не даёт этого сделать", async () => {
      ({ w, running } = await startPeriod(agent));
      expect(refused).toBe("rejected");
    });
    Then("строки о поднятом лимите среди шагов нет", async () => {
      const steps = (await w.player()).reviewSteps;
      expect(steps).toEqual(["Смотрю цифры за дни 1–7"]);
      expect(steps.join(" ")).not.toMatch(/лимит/i);
      agent.finish();
      await running;
    });
  });

  Scenario("Разбор сменяет шаги", ({ Given, When, Then }) => {
    let agent: PausingAgent;
    let w: OwnerWorld;
    Given("реклама запущена в симуляции с помощником, который останавливается посреди разбора", () => {
      agent = new PausingAgent(async (tools, snapshot) => {
        await tools.breakdown(searchOf(snapshot), "device");
      });
    });
    When("помощник закончил ход и написал разбор", async () => {
      const started = await startPeriod(agent);
      w = started.w;
      expect((await w.player()).reviewSteps).toHaveLength(2);
      agent.finish();
      await started.running;
    });
    Then("вместо шагов и точек появляется разбор, а модель за период вызывалась один раз", async () => {
      const player = await w.player();
      expect(player.status).toBe("paused");
      expect(player.reviewSteps).toEqual([]);
      expect((await w.store.turns("b1")).at(-1)).toMatchObject({ status: "completed", summary: "Посмотрел цифры за эти дни и записал, что проверю дальше." });
      expect(agent.turns).toBe(1);
    });
  });

  Scenario("Страница открыта посреди разбора", ({ Given, When, Then }) => {
    let agent: PausingAgent;
    let w: OwnerWorld;
    let running: Promise<unknown>;
    Given("реклама запущена в симуляции с помощником, который останавливается посреди разбора", () => {
      agent = new PausingAgent(async (tools, snapshot) => {
        await tools.recentInsights();
        await tools.breakdown(searchOf(snapshot), "query");
      });
    });
    When("владелец обновляет страницу, когда помощник уже выполнил три шага", async () => {
      ({ w, running } = await startPeriod(agent));
    });
    Then("сразу видны эти три шага", async () => {
      // A fresh page builds its player from the store, as the first poll does.
      expect((await w.player()).reviewSteps).toEqual(["Смотрю цифры за дни 1–7", "Вспоминаю, что уже заметил и что проверяю", "Смотрю, по каким запросам показывалась реклама в поиске"]);
      agent.finish();
      await running;
    });
  });

  Scenario("Без помощника шагов нет", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    Given("помощник у бизнеса в симуляции выключен", async () => {
      w = await ownerWorld();
      await w.store.setFlag("agent_enabled", false, "b1");
    });
    When("владелец отправляет период", async () => {
      await w.enter(7, { [PLAIN]: WEEK });
    });
    Then("шагов нет, а разбор — запись страховочных правил", async () => {
      expect((await w.player()).reviewSteps).toEqual([]);
      expect(await w.store.runningTurn("b1")).toBeNull();
      const rules = (await w.store.insights("b1")).filter((i) => i.reasonCode === "RULES_DAY");
      expect(rules.at(-1)?.observation).toContain("страховочные правила");
    });
  });
});
