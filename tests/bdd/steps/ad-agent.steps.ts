import { HeuristicPolicy, IdlePolicy, QuietPolicy, ReplayPolicy } from "@impuls/agent";
import type { AgentRuntime, AgentToolbox, ToolResult, TurnResult, TurnSnapshot } from "@impuls/agent";
import { factKey, rubles, toLocalDate } from "@impuls/core";
import type { InsightDraft } from "@impuls/core";
import { controlSimulation, enqueueAgentEvent, handleWebJob, processAgentInbox, RULES_DAY_CODE, rollback, runAgentTurn, SimulationDriver } from "@impuls/worker";
import type { TurnOutcome } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { featurePath, goodTruth, launchedWorld, noLeadsTruth, simulatedBusiness } from "./world";

const feature = await loadFeature(featurePath("ad-agent/turns.feature"), { language: "ru" });

/** Waits inside the turn until released, then tries one action. */
class WaitingPolicy implements AgentRuntime {
  readonly name = "policy:waiting";
  readonly instructionsVersion = "test";
  readonly decides = true;
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
    await input.tools.act(
      { type: "PauseAd", adId: "b1-d1-a2" },
      { reasonCode: "X", observation: "Отключили объявление.", factKeys: [factKey.goal(), factKey.budget("budget_left")], next: "Проверим через неделю." },
    );
    return { summary: "done", calls: [], usage: null };
  }
}

class GoalSpy implements AgentRuntime {
  readonly name = "policy:goal-spy";
  readonly instructionsVersion = "test";
  readonly decides = true;
  goal = 0;
  runTurn(input: { snapshot: TurnSnapshot }): Promise<TurnResult> {
    this.goal = input.snapshot.goal.costPerLeadRub;
    return Promise.resolve({ summary: "seen", calls: [], usage: null });
  }
}

/** Takes its turns, changes nothing, and each turn costs 100 ₽ of model spend. */
class CostlyPolicy extends QuietPolicy {
  override runTurn(): Promise<TurnResult> {
    return Promise.resolve({ summary: "Посмотрели рекламу.", calls: [], usage: { inputTokens: 1_000_000, outputTokens: 0, source: "api" } });
  }
}

/** Every request to the Agents API fails. */
class FailingPolicy implements AgentRuntime {
  readonly name = "policy:failing";
  readonly instructionsVersion = "test";
  readonly decides = true;
  runTurn(): Promise<TurnResult> {
    return Promise.reject(new Error("Agents API unavailable"));
  }
}

const replay = async (sim: SimulationDriver, calls: ConstructorParameters<typeof ReplayPolicy>[0][number]["calls"]): Promise<ToolResult[]> => {
  await runAgentTurn({ ...sim.ctx, agent: new ReplayPolicy([{ trigger: { kind: "daily_review" }, calls }]) }, "b1", { kind: "daily_review" });
  return ((await sim.store.turns("b1")).at(-1)?.calls as { result: ToolResult }[]).map((c) => c.result);
};

const lastSnapshot = async (sim: SimulationDriver): Promise<TurnSnapshot> => ((await sim.store.turns("b1")).at(-1)?.context as { snapshot: TurnSnapshot }).snapshot;

describeFeature(feature, ({ Scenario }) => {
  Scenario("Несколько отказов модерации подряд", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    Given("запущенная реклама с агентом", async () => {
      sim = await launchedWorld(30_000, { agent: new QuietPolicy() });
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
  Scenario("Агент включён по умолчанию", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    Given("сервис развёрнут с нуля", async () => {
      sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 3, agent: new QuietPolicy() });
      // What migration 0010 writes into a new database.
      await sim.store.setFlag("agent_enabled", true, null);
      await sim.store.saveBusiness({
        id: "b1",
        userId: "user-b1",
        timeZone: "Europe/Moscow",
        monthlyBudgetRub: 30_000,
        launchedOn: null,
        csoSource: { kind: "auto", reference: rubles(700) },
        miniSite: null,
        leadGoalId: null,
        mode: "direct",
        card: { category: "Маникюр", services: [{ name: "Маникюр", priceRub: 1_800 }], area: "Москва, ул. Профсоюзная, 1", hours: "Пн–Вс 10:00–22:00", advantages: [], name: "Ноготок", address: "Москва, ул. Профсоюзная, 1", city: "Москва", siteUrl: "https://nogotok.example/" },
      });
    });
    When("пользователь запускает рекламу", async () => {
      const plan = {
        landingUrl: "https://nogotok.example/",
        city: "Москва",
        directions: [
          { name: "Маникюр — Поиск", channel: "search" as const, weeklyLimitRub: 2_000, keywords: ["маникюр"], negativeKeywords: [], ads: [{ title: "Маникюр у метро", text: "Маникюр с покрытием за 1 800 ₽" }] },
          { name: "Маникюр — Сайты-партнёры", channel: "network" as const, weeklyLimitRub: 1_000, keywords: [], negativeKeywords: [], ads: [{ title: "Маникюр рядом", text: "Работаем до 22:00" }] },
        ],
      };
      await handleWebJob(sim.ctx, { kind: "launch", businessId: "b1", plan });
      await sim.runDays(2);
    });
    Then("выполняется ход агента по запуску, а на следующий день в 06:00 — ежедневный разбор", async () => {
      expect(await sim.store.directions("b1")).toHaveLength(2);
      const turns = (await sim.store.turns("b1")).filter((t) => t.status === "completed");
      expect(turns.map((t) => t.trigger)).toEqual(expect.arrayContaining(["launch", "daily_review"]));
      const daily = turns.find((t) => t.trigger === "daily_review");
      expect(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", hour: "2-digit", hourCycle: "h23" }).format(daily?.startedAt)).toBe("06");
      expect(await sim.store.pendingInbox("b1")).toEqual([]);
    });
  });

  Scenario("Агент не повторяет вывод", ({ Given, When, Then }) => {
    let world: Awaited<ReturnType<typeof simulatedBusiness>>;
    Given("реклама в поиске и на сайтах-партнёрах с агентом, который сравнил площадки по цене обращения", async () => {
      world = await simulatedBusiness(new HeuristicPolicy(), 2);
      expect((await world.store.insights("b1")).filter((i) => i.reasonCode === "CHANNELS_COMPARED")).toHaveLength(1);
    });
    When("следующие две недели агент каждый день разбирает рекламу", async () => {
      for (let day = 0; day < 12; day++) await controlSimulation(world.ctx, "b1", { action: "step_day" });
    });
    Then("он видит свой инсайт через инструмент чтения и не создаёт такой же", async () => {
      expect((await world.store.turns("b1")).filter((t) => t.trigger === "daily_review" && t.status === "completed").length).toBeGreaterThanOrEqual(12);
      expect((await world.store.insights("b1")).filter((i) => i.reasonCode === "CHANNELS_COMPARED")).toHaveLength(1);
    });
  });

  Scenario("Действие урезано ограничителем", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    Given("направление, которое приводит обращения дешевле цели, с лимитом 2 000 ₽ в неделю", async () => {
      sim = await launchedWorld(30_000, { agent: new QuietPolicy(), withBadAd: false });
      await sim.store.setFlag("automation_enabled", false, null);
      await sim.runDays(8);
    });
    When("агент поднимает лимит до 4 000 ₽ в неделю с инсайтом «реклама в поиске приводит клиентов дешевле цели»", async () => {
      const insight: InsightDraft = {
        reasonCode: "SCALE",
        observation: "Реклама в поиске приводит клиентов дешевле цели.",
        factKeys: [factKey.goal(), factKey.budget("budget_left")],
        next: "Через неделю проверим число обращений.",
      };
      expect((await replay(sim, [{ command: { type: "SetSpendLimit", directionId: "b1-d1", weeklyLimit: rubles(4_000) }, insight }]))[0]?.status).toBe("clamped");
    });
    Then("исполнитель урезает лимит до 2 400 ₽, а инсайт показывает в «Что решили»: «2 400 ₽ в неделю — урезано: не больше +20% за шаг»", async () => {
      expect((await sim.store.directions("b1")).find((d) => d.id === "b1-d1")?.weeklyLimit).toBe(rubles(2_400));
      const [insight] = await sim.store.insights("b1");
      expect(insight?.decision.status).toBe("clamped");
      expect(insight?.decision.text.replace(/[\u00a0\u202f]/g, " ")).toContain("2 400 ₽ в неделю — урезано: не больше +20% за шаг");
    });
  });

  Scenario("Динамика за неделю", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let snapshot: TurnSnapshot;
    Given("запущенная реклама с агентом, которая работает 14 дней", async () => {
      sim = await launchedWorld(30_000, { agent: new QuietPolicy() });
      await sim.store.setFlag("automation_enabled", false, null);
      await sim.runDays(14);
    });
    When("агент разбирает рекламу", async () => {
      await runAgentTurn(sim.ctx, "b1", { kind: "daily_review" });
      snapshot = await lastSnapshot(sim);
    });
    Then("снимок хода содержит обращения направления за последние 7 дней и за 7 дней до этого", () => {
      const value = (period: "7d" | "prev7d" | "14d") => snapshot.facts.find((f) => f.key === factKey.direction("b1-d1", "leads", period))?.value;
      expect(value("7d")).toBeDefined();
      expect(value("prev7d")).toBeDefined();
      expect((value("7d") ?? 0) + (value("prev7d") ?? 0)).toBe(value("14d"));
    });
    And("агент может привести их фактами инсайта", async () => {
      const results = await replay(sim, [
        {
          command: null,
          insight: {
            reasonCode: "TREND",
            observation: "Обращений за последнюю неделю стало меньше, чем неделей раньше.",
            factKeys: [factKey.direction("b1-d1", "leads", "7d"), factKey.direction("b1-d1", "leads", "prev7d")],
            next: "Посмотрим ещё неделю, прежде чем что-то менять.",
            decision: "Пока ничего не меняем — разница может быть случайной.",
          },
        },
      ]);
      expect(results[0]?.status).not.toBe("rejected");
      expect((await sim.store.insights("b1")).at(-1)?.facts.map((f) => f.period)).toEqual(["7d", "prev7d"]);
    });
  });

  Scenario("Исчерпан месячный лимит затрат", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    Given("запущенная реклама с агентом, где одно объявление тратит деньги без обращений, а месячного лимита затрат на модель хватает на два хода", async () => {
      sim = await launchedWorld(30_000, { agent: new CostlyPolicy() });
      // 1 M input tokens at 100 ₽ a turn, 200 ₽ a month.
      Object.assign(sim.ctx, { agentCosts: { inputKopecksPerMTok: 10_000, outputKopecksPerMTok: 40_000, monthlyLimitKopecks: 20_000, simulationRunLimitKopecks: 5_000 } });
    });
    When("проходит 14 дней", async () => {
      await sim.runDays(14);
    });
    Then("после двух ходов новые не запускаются", async () => {
      const turns = await sim.store.turns("b1");
      expect(turns.filter((t) => t.status === "completed")).toHaveLength(2);
      expect(turns.reduce((sum, t) => sum + t.costKopecks, 0)).toBe(20_000);
    });
    And("страховочное правило отключает объявление, а разбор дня говорит «Сегодня решения принимали страховочные правила: лимит расходов на помощника исчерпан»", async () => {
      const pause = (await sim.store.changes("b1")).find((c) => c.actor === "safety_net" && c.action.type === "PauseAd");
      expect(pause?.status).toBe("applied");
      const day = (at: Date) => toLocalDate(at, "Europe/Moscow");
      const marker = (await sim.store.insights("b1")).find((i) => i.reasonCode === RULES_DAY_CODE && pause && day(i.createdAt) === day(pause.createdAt));
      expect(marker?.observation).toBe("Сегодня решения принимали страховочные правила: лимит расходов на помощника исчерпан");
    });
  });

  Scenario("Agents API недоступен двое суток", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    Given("запущенная реклама с агентом, где одно объявление тратит деньги без обращений, а все запросы к Agents API возвращают ошибки", async () => {
      sim = await launchedWorld(30_000, { agent: new FailingPolicy() });
    });
    When("проходит 14 дней", async () => {
      await sim.runDays(14);
    });
    Then("бюджет не превышен, объявление отключено страховочным правилом, его инсайт есть в ленте, а команда получила инцидент", async () => {
      const ids = (await sim.store.directions("b1")).map((d) => d.platformCampaignId);
      expect(sim.platform.trueSpend(ids, "2026-10-01", "2026-10-31")).toBeLessThanOrEqual(rubles(30_000));
      const pause = (await sim.store.changes("b1")).find((c) => c.actor === "safety_net" && c.action.type === "PauseAd" && c.status === "applied");
      expect((await sim.store.insights("b1")).find((i) => i.id === pause?.insightId)?.source).toBe("rule");
      expect((await sim.store.incidents()).filter((i) => i.kind === "agent_unavailable")).toHaveLength(1);
    });
  });

  Scenario("Месяц без агента", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    Given("агент выключен, а у бизнеса одно неэффективное объявление, одно эффективное направление, упирающееся в лимит, и одно пограничное объявление", async () => {
      sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 7, agent: new IdlePolicy(), agentEnabled: false });
      await sim.launchBusiness({
        id: "b1",
        monthlyBudgetRub: 60_000,
        launchedOn: "2026-10-01",
        csoSource: { kind: "user", goal: rubles(800) },
        directions: [
          { name: "Маникюр — Поиск", weeklyLimitRub: 2_000, ads: [{ title: "Маникюр у метро", truth: goodTruth }, { title: "Маникюр без записи", truth: noLeadsTruth }] },
          { name: "Педикюр — Поиск", weeklyLimitRub: 1_500, ads: [{ title: "Педикюр", truth: goodTruth }] },
          { name: "Наращивание — Поиск", weeklyLimitRub: 7_000, ads: [{ title: "Наращивание ногтей", truth: { impressionsPerDay: 2_000, ctr: 0.06, cr: 0.022, costPerClick: rubles(20) } }] },
        ],
      });
    });
    When("проходит 30 дней", async () => {
      await sim.runDays(30);
    });
    Then("неэффективное объявление поставлено на паузу", async () => {
      expect((await sim.store.ads("b1")).find((a) => a.title === "Маникюр без записи")?.status).toBe("paused");
    });
    And("лимит эффективного направления увеличен", async () => {
      expect((await sim.store.directions("b1")).find((d) => d.id === "b1-d2")?.weeklyLimit).toBeGreaterThan(rubles(1_500));
    });
    And("для пограничного объявления запущен эксперимент", async () => {
      expect((await sim.store.experiments("b1")).map((e) => e.adId)).toContain("b1-d3-a1");
    });
    And("каждое действие есть в истории с объяснением и в ленте инсайтов, а отключение и изменение лимита можно откатить", async () => {
      expect(await sim.store.turns("b1")).toEqual([]);
      const automated = (await sim.store.changes("b1")).filter((c) => c.actor === "safety_net" && c.status === "applied");
      const insights = new Set((await sim.store.insights("b1")).map((i) => i.id));
      expect(automated.every((c) => c.insightId !== null && c.insightId !== undefined && insights.has(c.insightId))).toBe(true);
      expect(automated.map((c) => c.action.type)).toEqual(expect.arrayContaining(["PauseAd", "SetSpendLimit", "StartExperiment"]));
      expect(automated.every((c) => c.explanation.trim() !== "")).toBe(true);
      const pause = automated.find((c) => c.action.type === "PauseAd");
      expect((await rollback(sim.ctx, { businessId: "b1", entryId: pause?.id ?? "", includeLater: true })).kind).toBe("done");
    });
  });
});
