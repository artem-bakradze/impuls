import { HeuristicPolicy, ReplayPolicy, TemplateCreativeEngine } from "@impuls/agent";
import type { AgentRuntime, AgentToolbox, TurnResult, TurnSnapshot, TurnTrigger } from "@impuls/agent";
import { allowedWeeklyTotal, factKey, monthBudget, rubles, toLocalDate } from "@impuls/core";
import {
  CommandExecutor,
  controlSimulation,
  deliverNotifications,
  inverseCommands,
  launchSimulation,
  ManualClock,
  MemoryLockManager,
  MemoryStore,
  SimulationError,
  handleWebJob,
  tickSimulation,
  tickSimulations,
  createLogger,
  runAgentTurn,
  withSimulation,
  isAdDecision,
  isBudgetAdjustment,
  SCENARIOS,
  scenarioStartDate,
} from "@impuls/worker";
import type { ScenarioId } from "@impuls/worker";
import type { JobContext, LaunchPlan, Mailer } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { feedDays } from "../../../apps/web/src/lib/insights-model";
import type { DayReviewModel } from "../../../apps/web/src/lib/insights-model";
import { agentTurnText } from "../../../apps/web/src/lib/simulation-model";
import { buildDecisionScreen, scenarioTruth } from "../../../apps/web/src/lib/simulation-screen";
import { featurePath } from "./world";

const feature = await loadFeature(featurePath("simulation-mode/simulation.feature"), { language: "ru" });

const START = new Date("2026-11-03T07:00:00Z");
const SCENARIO_BY_TITLE: Record<string, string> = {
  "Обычный месяц": "regular",
  "Одно объявление не приносит клиентов": "dead_ad",
  "Пограничное объявление": "borderline",
  "Правка в кабинете": "cabinet_edit",
};

/** A launched-from-the-wizard plan: three ads per channel, limits for 15 000 ₽ on the scenario's virtual launch day. */
const wizardPlan = (scenario: ScenarioId, searchAds = 3): LaunchPlan => {
  const today = scenarioStartDate(SCENARIOS[scenario], toLocalDate(START, "Europe/Moscow"));
  const total = Math.floor(allowedWeeklyTotal(0, monthBudget(15_000, today, today), today) / 100);
  return {
    landingUrl: "https://nogotok.example",
    city: "Москва",
    directions: [
      { name: "Маникюр — Поиск", channel: "search", weeklyLimitRub: Math.floor(total * 0.6), keywords: ["маникюр москва"], negativeKeywords: [], ads: Array.from({ length: searchAds }, (_, i) => ({ title: `Маникюр ${i + 1}`, text: "У метро, без очереди" })) },
      { name: "Маникюр — Сайты-партнёры", channel: "network", weeklyLimitRub: total - Math.floor(total * 0.6), keywords: [], negativeKeywords: [], ads: [1, 2, 3].map((i) => ({ title: `Ноготок ${i}`, text: "Запись онлайн" })) },
    ],
  };
};

/**
 * The worker's context in memory with the deterministic test agent (a simulation always runs with the agent); any
 * call to the Direct platform fails the scenario.
 */
const world = async (agent: AgentRuntime = new HeuristicPolicy()) => {
  const store = new MemoryStore();
  store.emails.set("b1", "owner@example.com");
  await store.saveBusiness({
    id: "b1",
    userId: "u1",
    timeZone: "Europe/Moscow",
    monthlyBudgetRub: 15_000,
    launchedOn: null,
    csoSource: { kind: "auto", reference: rubles(500) },
    miniSite: null,
    leadGoalId: null,
    mode: "direct",
    card: { category: "Маникюр", services: [{ name: "Маникюр с покрытием", priceRub: 1_800 }], area: "", hours: "Пн–Вс 10:00–20:00", advantages: [], name: "Ноготок", address: "", city: "Москва", siteUrl: "https://nogotok.example" },
  });
  const clock = new ManualClock(START);
  const locks = new MemoryLockManager();
  const directCalls: string[] = [];
  const platformFor = (businessId: string) => {
    directCalls.push(businessId);
    throw new Error("The Direct API must not be called in a simulation");
  };
  const ctx: JobContext = { store, clock, locks, executor: new CommandExecutor({ store, locks, clock, platformFor }), platformFor, agent, creatives: new TemplateCreativeEngine() };
  return { store, clock, ctx, directCalls };
};

type World = Awaited<ReturnType<typeof world>>;

const launched = async (title: string, agent?: AgentRuntime, goalRub?: number): Promise<World> => {
  const w = await world(agent);
  if (goalRub !== undefined) {
    await w.store.saveBusiness({ ...(await w.store.getBusiness("b1")), csoSource: { kind: "user", goal: rubles(goalRub) } });
  }
  const scenario = SCENARIO_BY_TITLE[title] as ScenarioId | undefined;
  if (scenario === undefined) throw new Error(`Unknown scenario ${title}`);
  await launchSimulation(w.ctx, "b1", wizardPlan(scenario), scenario);
  return w;
};

/** «До следующего решения» on the ticker until the simulation pauses. */
const untilDecision = async (w: World) => {
  await controlSimulation(w.ctx, "b1", { action: "until_decision" });
  for (let second = 0; second < 900 && (await w.store.getSimulation("b1"))?.status !== "paused"; second++) {
    w.clock.set(new Date(w.clock.now().getTime() + 1_000));
    await tickSimulations(w.ctx, createLogger());
  }
};

const untilDay = async (w: World, day: number) => {
  const record = await w.store.getSimulation("b1");
  const done = Math.floor(((record?.simNow.getTime() ?? 0) - (record?.startedAt.getTime() ?? 0)) / 86_400_000);
  for (let d = done; d < day; d++) await controlSimulation(w.ctx, "b1", { action: "step_day" });
};

const dayOf = async (w: World, at: Date) => Math.floor((at.getTime() - ((await w.store.getSimulation("b1"))?.startedAt.getTime() ?? 0)) / 86_400_000) + 1;

/** The decisions screen's feed: insights with the scenario's truth against the goal of each decision. */
const simulationFeed = async (w: World, goal = rubles(500)): Promise<DayReviewModel[]> => {
  const simulation = await w.store.getSimulation("b1");
  if (!simulation) throw new Error("no simulation");
  return feedDays({
    insights: await w.store.insights("b1"),
    turns: await w.store.turnDigests("b1"),
    timeZone: "Europe/Moscow",
    since: null,
    entries: new Map(),
    truthOf: scenarioTruth({ simulation, ads: await w.store.ads("b1"), goal }),
  });
};

const plain = (text: string | undefined) => text?.replace(/[\u00a0\u202f]/g, " ") ?? "";

/** The deterministic agent that, once armed, thinks over its turn until released, as a model turn of many seconds would. */
class SlowAgent implements AgentRuntime {
  readonly name = "policy:slow";
  readonly instructionsVersion = "test";
  readonly decides = true;
  armed = false;
  private readonly inner = new HeuristicPolicy();
  private release: () => void = () => undefined;
  private markStarted: () => void = () => undefined;
  readonly started = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });
  async runTurn(input: { trigger: TurnTrigger; snapshot: TurnSnapshot; tools: AgentToolbox; signal: AbortSignal }): Promise<TurnResult> {
    if (this.armed) {
      this.armed = false;
      await new Promise<void>((resolve) => {
        this.release = resolve;
        this.markStarted();
      });
    }
    return this.inner.runTurn(input);
  }
  finish(): void {
    this.release();
  }
}

const screen = async (w: World) => {
  const simulation = await w.store.getSimulation("b1");
  if (!simulation) throw new Error("no simulation");
  return buildDecisionScreen({ simulation, timeZone: "Europe/Moscow", monthlyBudgetRub: 15_000, directions: await w.store.directions("b1"), changes: await w.store.changes("b1") });
};

describeFeature(feature, ({ Scenario }) => {
  Scenario("Запуск в симуляции без Директа", ({ Given, When, Then, And }) => {
    let w: World;
    Given("владелец прошёл мастер с бюджетом 15 000 ₽", async () => {
      w = await world();
    });
    When("он выбирает «Запустить в симуляции» со сценарием «Обычный месяц»", async () => {
      expect((await launchSimulation(w.ctx, "b1", wizardPlan("regular"), "regular")).status).toBe("launched");
    });
    Then("кампании созданы в симуляторе, а в Директ не ушло ни одного запроса", async () => {
      expect((await w.store.directions("b1")).length).toBe(2);
      expect((await w.store.getSimulation("b1"))?.state.campaigns.length).toBe(2);
      expect((await w.store.getBusiness("b1")).mode).toBe("simulation");
      expect(w.directCalls).toEqual([]);
    });
    And("в истории есть запись «Реклама запущена»", async () => {
      expect((await w.store.changes("b1"))[0]?.explanation).toMatch(/^Реклама запущена/);
    });
  });

  Scenario("Месяц симуляции — календарный", ({ Given, When, Then }) => {
    let w: World;
    Given("владелец прошёл мастер с бюджетом 15 000 ₽ 30 октября", async () => {
      w = await world();
      w.clock.set(new Date("2026-10-30T07:00:00Z"));
    });
    When("он выбирает «Запустить в симуляции» со сценарием «Обычный месяц»", async () => {
      expect((await launchSimulation(w.ctx, "b1", wizardPlan("regular"), "regular")).status).toBe("launched");
    });
    Then("симуляция начинается 1 ноября в 09:00 с полным бюджетом месяца 15 000 ₽", async () => {
      const simulation = await w.store.getSimulation("b1");
      expect(simulation?.startedAt.toISOString()).toBe("2026-11-01T06:00:00.000Z");
      const start = toLocalDate(simulation?.startedAt ?? new Date(), "Europe/Moscow");
      expect(monthBudget(15_000, start, start)).toBe(rubles(15_000));
    });
  });

  Scenario("Плохая реклама отключена", ({ Given, When, Then, And }) => {
    let w: World;
    Given("реклама запущена в симуляции со сценарием «Одно объявление не приносит клиентов»", async () => {
      w = await launched("Одно объявление не приносит клиентов");
    });
    When("симуляция доходит до 14-го дня", async () => {
      await untilDay(w, 14);
    });
    Then("реклама без обращений отключена агентом или страховочным правилом, с записью в истории и инсайтом с цифрами", async () => {
      const pause = (await w.store.changes("b1")).find((c) => (c.actor === "agent" || c.actor === "safety_net") && c.status === "applied" && (c.action.type === "PauseAd" || c.action.type === "PauseDirection"));
      expect(pause?.explanation).not.toBe("");
      const insight = (await w.store.insights("b1")).find((i) => i.id === pause?.insightId);
      expect(insight?.facts.length).toBeGreaterThanOrEqual(2);
    });
    And("рекламе, которая приводит клиентов, добавлены деньги", async () => {
      const raised = (await w.store.changes("b1")).filter((c) => (c.actor === "agent" || c.actor === "safety_net") && c.status === "applied" && c.action.type === "SetSpendLimit");
      expect(raised.some((c) => Number(c.after.weeklyLimit) > Number(c.before.weeklyLimit))).toBe(true);
    });
  });

  Scenario("A/B-тест доведён до вывода", ({ Given, When, Then }) => {
    let w: World;
    Given("реклама запущена в симуляции со сценарием «Пограничное объявление»", async () => {
      w = await launched("Пограничное объявление");
    });
    When("симуляция доходит до 30-го дня", async () => {
      await untilDay(w, 30);
    });
    Then("проверка нового варианта завершена, а итог с цифрами обоих вариантов записан в истории и показан инсайтом", async () => {
      const finished = (await w.store.changes("b1")).find((c) => c.action.type === "FinishExperiment" && c.status === "applied");
      expect(finished?.explanation).toMatch(/обращени.* по .*₽/);
      expect((await w.store.experiments("b1")).some((e) => e.status === "finished")).toBe(true);
      const insight = (await w.store.insights("b1")).find((i) => i.id === finished?.insightId);
      expect(insight?.facts.map((f) => f.object)).toEqual(expect.arrayContaining(["оставленный вариант", "отключённый вариант"]));
    });
  });

  Scenario("Правка в кабинете", ({ Given, When, Then }) => {
    let w: World;
    Given("реклама запущена в симуляции со сценарием «Правка в кабинете»", async () => {
      w = await launched("Правка в кабинете");
    });
    When("симуляция доходит до 5-го дня", async () => {
      await untilDay(w, 5);
    });
    Then("в истории есть изменение с автором «Изменено в кабинете Директа», и его можно вернуть", async () => {
      const edit = (await w.store.changes("b1")).find((c) => c.author === "cabinet");
      expect(edit).toBeDefined();
      expect(await dayOf(w, edit?.createdAt ?? new Date(0))).toBe(5);
      expect(edit ? inverseCommands(edit) : null).not.toBeNull();
    });
  });

  Scenario("Письма не уходят", ({ Given, When, Then }) => {
    let w: World;
    const sent: string[] = [];
    Given("реклама запущена в симуляции со сценарием «Обычный месяц»", async () => {
      w = await launched("Обычный месяц");
    });
    When("у бизнеса появляется событие «Пополните баланс в Яндекс Директе»", async () => {
      await w.store.notify({ businessId: "b1", kind: "low_balance", message: "Пополните баланс в Яндекс Директе", at: START });
      const mailer: Mailer = { send: (mail) => Promise.resolve(void sent.push(mail.to)) };
      await deliverNotifications(w.ctx, mailer, createLogger());
    });
    Then("письмо не отправляется, а событие видно на сводке", async () => {
      expect(sent).toEqual([]);
      expect((await w.store.notifications("b1")).map((n) => n.message)).toContain("Пополните баланс в Яндекс Директе");
    });
  });

  Scenario("Воспроизводимость рынка", ({ Given, When, Then }) => {
    let w: World;
    let first: unknown;
    const snapshot = async () => ({
      truths: (await w.store.getSimulation("b1"))?.state.truths,
      changes: (await w.store.changes("b1")).map((c) => [c.reasonCode, c.createdAt.toISOString(), c.explanation]),
      insights: (await w.store.insights("b1")).map((i) => [i.source, i.reasonCode, i.observation, i.createdAt.toISOString()]),
      stats: await w.store.stats("b1", "2026-01-01", "2027-12-31"),
    });
    Given("реклама запущена в симуляции со сценарием «Обычный месяц» и прошла 10 дней", async () => {
      w = await launched("Обычный месяц");
      await untilDay(w, 10);
      first = await snapshot();
      expect((await w.store.turns("b1")).length).toBeGreaterThan(0);
    });
    When("владелец нажимает «Начать заново» и снова доводит симуляцию до 10-го дня", async () => {
      await controlSimulation(w.ctx, "b1", { action: "restart" });
      await untilDay(w, 10);
    });
    Then("правда объявлений та же, а с тестовой политикой агента расходы, обращения, записи истории и инсайты совпадают с первым прогоном", async () => {
      expect(await snapshot()).toEqual(first);
    });
  });

  Scenario("Агент не видит правду сценария", ({ Given, When, Then }) => {
    let w: World;
    Given("реклама запущена в симуляции со сценарием «Одно объявление не приносит клиентов»", async () => {
      w = await launched("Одно объявление не приносит клиентов");
    });
    When("симуляция доходит до 10-го дня", async () => {
      await untilDay(w, 10);
    });
    Then("в снимках ходов агента нет скрытой правды объявлений и событий сценария, только статистика", async () => {
      const turns = await w.store.turns("b1");
      expect(turns.length).toBeGreaterThan(0);
      const sent = JSON.stringify(turns.map((t) => t.context));
      expect(sent).not.toMatch(/"(cr|ctr|costPerClick|impressionsPerDay|truth|truths|events|cells|scenario)"/);
      expect(sent).toMatch(/"spend14Rub"/);
    });
  });

  Scenario("Агент разбирает день", ({ Given, When, Then, And }) => {
    let w: World;
    const agent = new SlowAgent();
    let tick: Promise<void> = Promise.resolve();
    let thinking = 0;
    const second = () => w.clock.set(new Date(w.clock.now().getTime() + 1_000));
    Given("реклама запущена в симуляции со сценарием «Обычный месяц» и прошла 7 дней, а агент разбирает день долго", async () => {
      w = await launched("Обычный месяц", agent);
      await untilDay(w, 7);
      agent.armed = true;
      await controlSimulation(w.ctx, "b1", { action: "resume" });
    });
    When("симуляция идёт, и агент начинает ежедневный разбор", async () => {
      let started = false;
      void agent.started.then(() => {
        started = true;
      });
      for (let i = 0; i < 60 && !started; i++) {
        second();
        tick = tickSimulation(w.ctx, createLogger(() => undefined), "b1");
        await Promise.race([tick, agent.started]);
      }
      expect(started).toBe(true);
    });
    Then("виртуальное время стоит, пока агент думает, а пульт показывает «Агент разбирает N-й день…»", async () => {
      const record = await w.store.getSimulation("b1");
      thinking = record?.simNow.getTime() ?? 0;
      const turnStarted = await w.store.runningTurnStartedAt("b1");
      expect(turnStarted).not.toBeNull();
      // Thirty real seconds of thinking: the tick of this simulation is still running, the next ones wait for it.
      for (let i = 0; i < 30; i++) {
        second();
        await tickSimulation(w.ctx, createLogger(() => undefined), "b1");
      }
      expect((await w.store.getSimulation("b1"))?.simNow.getTime()).toBe(thinking);
      const day = Math.floor(((turnStarted?.getTime() ?? 0) - (record?.startedAt.getTime() ?? 0)) / 86_400_000) + 1;
      expect(agentTurnText({ day })).toBe(`Агент разбирает ${day}-й день…`);
    });
    And("после хода время идёт дальше, а в ленте появляется разбор этого дня", async () => {
      const turnDay = toLocalDate((await w.store.runningTurnStartedAt("b1")) ?? new Date(), "Europe/Moscow");
      agent.finish();
      await tick;
      expect(await w.store.runningTurnStartedAt("b1")).toBeNull();
      second();
      await tickSimulation(w.ctx, createLogger(() => undefined), "b1");
      const moved = ((await w.store.getSimulation("b1"))?.simNow.getTime() ?? 0) - thinking;
      // The thirty seconds did not turn into virtual time: one second at «1 день = 10 секунд» is a few hours.
      expect(moved).toBeGreaterThan(0);
      expect(moved).toBeLessThanOrEqual(6 * 3_600_000);
      expect((await simulationFeed(w)).some((d) => d.date === turnDay)).toBe(true);
    });
  });

  Scenario("Инсайт с правдой сценария", ({ Given, When, Then }) => {
    let w: World;
    Given("реклама запущена в симуляции со сценарием «Одно объявление не приносит клиентов»", async () => {
      w = await launched("Одно объявление не приносит клиентов");
    });
    When("симуляция доходит до 14-го дня", async () => {
      await untilDay(w, 14);
    });
    Then("в ленте экрана есть инсайт об отключении объявления без обращений со строкой «На самом деле: объявление не приводит обращений»", async () => {
      const cards = (await simulationFeed(w)).flatMap((d) => d.insights);
      const pause = cards.find((c) => c.decision.status === "applied" && c.decision.text === "Отключили объявление «Маникюр 1»");
      expect(pause?.facts.length).toBeGreaterThanOrEqual(2);
      expect(pause?.truth).toEqual({ text: "На самом деле: объявление не приводит обращений", tone: "danger" });
    });
  });

  Scenario("Ошибка понимания видна", ({ Given, When, Then }) => {
    let w: World;
    Given("реклама запущена в симуляции со сценарием «Обычный месяц» с целью 100 ₽ за обращение и прошла 8 дней", async () => {
      w = await launched("Обычный месяц", undefined, 100);
      await untilDay(w, 8);
    });
    When("агент добавляет денег рекламе в поиске", async () => {
      const search = (await w.store.directions("b1")).find((d) => d.channel === "search");
      if (!search) throw new Error("no search advertising");
      const insight = {
        reasonCode: "SCALE_MISREAD",
        observation: "Реклама в поиске приводит клиентов дешевле цели.",
        factKeys: [factKey.goal(), factKey.budget("budget_left")],
        next: "Через неделю проверим число обращений.",
      };
      await withSimulation(w.ctx, "b1", async (world) => {
        const agent = new ReplayPolicy([{ trigger: { kind: "daily_review" }, calls: [{ command: { type: "SetSpendLimit", directionId: search.id, weeklyLimit: Math.floor(search.weeklyLimit * 1.2) }, insight }] }]);
        await runAgentTurn({ ...world.ctx, agent }, "b1", { kind: "daily_review" });
      });
    });
    Then("у инсайта стоит строка «На самом деле: обращение примерно за … — дороже цели 100 ₽»", async () => {
      const card = (await simulationFeed(w, rubles(100))).flatMap((d) => d.insights).find((c) => c.observation === "Реклама в поиске приводит клиентов дешевле цели.");
      expect(plain(card?.truth?.text)).toMatch(/^На самом деле: обращение примерно за [\d ]+ ₽ — дороже цели 100 ₽$/);
    });
  });

  Scenario("До следующего решения", ({ Given, When, Then }) => {
    let w: World;
    Given("реклама запущена в симуляции со сценарием «Одно объявление не приносит клиентов»", async () => {
      w = await launched("Одно объявление не приносит клиентов");
    });
    When("владелец нажимает «До следующего решения»", async () => {
      await untilDecision(w);
    });
    Then("симуляция идёт до первого решения сервиса про рекламу и встаёт на паузу, а пульт показывает его объяснение", async () => {
      const record = await w.store.getSimulation("b1");
      expect(record?.status).toBe("paused");
      // The pult shows the newest decision about the ads; it was made in the last virtual hour.
      const decision = [...(await w.store.changes("b1"))].reverse().find(isAdDecision);
      expect(decision?.explanation).toBeTruthy();
      expect((record?.simNow.getTime() ?? 0) - (decision?.createdAt.getTime() ?? 0)).toBeLessThanOrEqual(3_600_000);
    });
  });

  Scenario("Подстройка лимита — не решение", ({ Given, When, Then }) => {
    let w: World;
    Given("реклама запущена в симуляции со сценарием «Одно объявление не приносит клиентов»", async () => {
      w = await launched("Одно объявление не приносит клиентов");
    });
    When("владелец нажимает «До следующего решения»", async () => {
      await untilDecision(w);
    });
    Then("защита бюджета по пути снижала лимиты, но симуляция на этом не остановилась", async () => {
      const changes = await w.store.changes("b1");
      const firstCut = changes.findIndex(isBudgetAdjustment);
      const decision = changes.findIndex(isAdDecision);
      // The cut came first and the run went on past it, to the decision.
      expect(firstCut).toBeGreaterThanOrEqual(0);
      expect(decision).toBeGreaterThan(firstCut);
      expect((await w.store.getSimulation("b1"))?.status).toBe("paused");
    });
  });

  Scenario("Сравнение по ходу симуляции", ({ Given, When, Then }) => {
    let w: World;
    Given("реклама запущена в симуляции со сценарием «Обычный месяц»", async () => {
      w = await launched("Обычный месяц");
    });
    When("симуляция доходит до 12-го дня", async () => {
      await untilDay(w, 11);
    });
    Then("экран сравнивает обращения с сервисом и без него за 12 дней, по дням, и цифры с сервисом совпадают с данными симулятора", async () => {
      const model = await screen(w);
      expect(model.day).toBe(12);
      expect(model.comparison?.service).toHaveLength(12);
      expect(model.comparison?.baseline).toHaveLength(12);
      const simulation = await w.store.getSimulation("b1");
      const campaigns = new Set((await w.store.directions("b1")).map((d) => d.platformCampaignId));
      const cells = (simulation?.state.cells ?? []).filter((c) => campaigns.has(c.campaignId));
      expect(model.comparison?.serviceNow.leads).toBe(cells.reduce((sum, c) => sum + c.leads, 0));
      expect(model.comparison?.serviceNow.spend).toBe(cells.reduce((sum, c) => sum + c.spend, 0));
    });
  });

  Scenario("Чек-лист по сценарию", ({ Given, When, Then }) => {
    let w: World;
    Given("реклама запущена в симуляции со сценарием «Одно объявление не приносит клиентов»", async () => {
      w = await launched("Одно объявление не приносит клиентов");
    });
    When("симуляция доходит до 3-го дня", async () => {
      await untilDay(w, 2);
    });
    Then("чек-лист показывает «1 из 4»: отмечен только бюджет, у отключения подсказка «Обычно к 14-му дню», а пункта о правке в кабинете нет", async () => {
      const items = (await screen(w)).checklist;
      expect(items.map((i) => [i.key, i.done])).toEqual([
        ["pause", false],
        ["scale", false],
        ["rollback", false],
        ["budget", true],
      ]);
      expect(items.find((i) => i.key === "pause")?.hint).toBe("Обычно к 14-му дню");
    });
  });

  Scenario("Конец сценария и контрольный прогон", ({ Given, When, Then }) => {
    let w: World;
    Given("реклама запущена в симуляции со сценарием «Одно объявление не приносит клиентов»", async () => {
      w = await launched("Одно объявление не приносит клиентов");
    });
    When("симуляция доходит до конца 30-го дня", async () => {
      await untilDay(w, 30);
    });
    Then("она стоит на паузе, а итог сравнивает расходы и обращения с прогоном без действий сервиса", async () => {
      expect((await w.store.getSimulation("b1"))?.status).toBe("paused");
      const result = (await screen(w)).result;
      expect(result?.days).toBe(30);
      expect(result?.baseline.spend).toBeGreaterThan(0);
      expect(result?.service.spend).toBeGreaterThan(0);
      expect(result?.service.spend).toBeLessThanOrEqual(rubles(15_000));
    });
  });

  Scenario("Чек-лист критериев", ({ Given, When, Then }) => {
    let w: World;
    Given("реклама запущена в симуляции со сценарием «Одно объявление не приносит клиентов» и дошла до 30-го дня", async () => {
      w = await launched("Одно объявление не приносит клиентов");
      await untilDay(w, 30);
    });
    When("владелец откатывает решение сервиса «Выделил больше денег»", async () => {
      // The newest raise that comes back in one step; one followed by another decision of the service asks for the chain.
      const raises = (await w.store.changes("b1")).filter((c) => c.reasonCode === "SAFETY_SCALE_EFFECTIVE").reverse();
      expect(raises.length).toBeGreaterThan(0);
      let kind = "";
      for (const entry of raises) {
        kind = ((await handleWebJob(w.ctx, { kind: "rollback", businessId: "b1", entryId: entry.id })) as { kind: string }).kind;
        if (kind === "done") break;
      }
      expect(kind).toBe("done");
    });
    Then("отмечены все пункты чек-листа сценария, и у каждого действия сервиса есть ссылка на запись истории", async () => {
      const items = (await screen(w)).checklist;
      expect(items.map((i) => i.key)).toEqual(expect.arrayContaining(["pause", "scale", "rollback", "budget"]));
      expect(items.every((i) => i.done)).toBe(true);
      const ids = new Set((await w.store.changes("b1")).map((c) => c.id));
      for (const item of items.filter((i) => i.key !== "budget")) {
        expect(ids.has(item.entryId ?? "")).toBe(true);
      }
    });
  });

  Scenario("Переход к настоящему запуску", ({ Given, When, Then }) => {
    let w: World;
    Given("реклама запущена в симуляции со сценарием «Обычный месяц» и прошла 3 дня", async () => {
      w = await launched("Обычный месяц");
      await untilDay(w, 3);
    });
    When("владелец нажимает «Запустить по-настоящему»", async () => {
      await controlSimulation(w.ctx, "b1", { action: "go_real" });
    });
    Then("данные симуляции удалены, описание бизнеса сохранено, а мастер открыт на шаге 6", async () => {
      expect(await w.store.getSimulation("b1")).toBeNull();
      expect(await w.store.directions("b1")).toEqual([]);
      expect(await w.store.changes("b1")).toEqual([]);
      const business = await w.store.getBusiness("b1");
      expect(business).toMatchObject({ mode: "direct", launchedOn: null });
      expect(business.card.services).toEqual([{ name: "Маникюр с покрытием", priceRub: 1_800 }]);
    });
  });

  Scenario("Сценарию не хватает объявлений", ({ Given, When, Then }) => {
    let w: World;
    let error: unknown;
    Given("владелец оставил одно объявление в поиске", async () => {
      w = await world();
    });
    When("он выбирает сценарий «Одно объявление не приносит клиентов»", async () => {
      error = await launchSimulation(w.ctx, "b1", wizardPlan("dead_ad", 1), "dead_ad").catch((e: unknown) => e);
    });
    Then("сценарий недоступен с пояснением «Нужно хотя бы 2 объявления в поиске — сейчас 1»", () => {
      expect(error).toBeInstanceOf(SimulationError);
      expect((error as Error).message).toBe("Нужно хотя бы 2 объявления в поиске — сейчас 1");
    });
  });
});
