import { HeuristicPolicy, IdlePolicy, QuietPolicy, ReplayPolicy } from "@impuls/agent";
import type { AgentRuntime, ToolResult, TurnResult, TurnSnapshot } from "@impuls/agent";
import { factKey } from "@impuls/core";
import type { InsightDraft } from "@impuls/core";
import { ACTION_META, controlSimulation, isBudgetAdjustment, QUIET_DAY_CODE, RULES_DAY_CODE, runAgentTurn } from "@impuls/worker";
import type { ChangeEntry, SimulationDriver } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import type { HistoryItem } from "../../../apps/web/src/lib/history-view";
import { feedDays, QUIET_DAYS } from "../../../apps/web/src/lib/insights-model";
import type { DayReviewModel, InsightCardModel } from "../../../apps/web/src/lib/insights-model";
import { ownerWorld } from "./owner-world";
import type { OwnerWorld } from "./owner-world";
import { featurePath, launchedWorld, simulatedBusiness } from "./world";

const feature = await loadFeature(featurePath("insights/insights.feature"), { language: "ru" });

const BAD_AD = "b1-d1-a2";
const plain = (text: string | undefined) => text?.replace(/[  ]/g, " ") ?? "";

/** What the history screen knows about an entry, enough for «Вернуть как было» on a card. */
const entry = (c: ChangeEntry): HistoryItem => {
  const reversible = ACTION_META[c.action.type].reversible && c.status === "applied" && c.revertedById === null && !isBudgetAdjustment(c);
  return {
    id: c.id,
    at: c.createdAt.toISOString(),
    author: c.author,
    object: "",
    diff: [],
    explanation: c.explanation,
    outcome: c.outcome,
    turnId: c.turnId,
    insight: null,
    status: c.status,
    reverted: c.revertedById !== null,
    rollback: reversible ? { kind: "available", consequences: [] } : { kind: "unavailable", reason: "" },
    budgetAdjustment: isBudgetAdjustment(c),
  };
};

/** The feed as the summary builds it (apps/web lib/server/insights), without the web runtime. */
const feed = async (sim: { store: SimulationDriver["store"] }, businessId = "b1"): Promise<DayReviewModel[]> =>
  feedDays({
    insights: await sim.store.insights(businessId),
    turns: await sim.store.turnDigests(businessId),
    timeZone: "Europe/Moscow",
    since: null,
    entries: new Map((await sim.store.changes(businessId)).map((c) => [c.id, entry(c)])),
  });

const cards = async (sim: SimulationDriver): Promise<InsightCardModel[]> => (await feed(sim)).flatMap((d) => d.insights);

/** 14 days of data with an agent that takes its turns and changes nothing; the rules are off, so nothing is decided yet. */
const evaluated = async (): Promise<SimulationDriver> => {
  const sim = await launchedWorld(30_000, { agent: new QuietPolicy() });
  await sim.store.setFlag("automation_enabled", false, null);
  await sim.runDays(14);
  return sim;
};

const insight: InsightDraft = {
  reasonCode: "PAUSE_INEFFECTIVE",
  observation: "Объявление тратит деньги и не приводит клиентов.",
  factKeys: [factKey.ad(BAD_AD, "spend", "14d"), factKey.ad(BAD_AD, "leads", "14d"), factKey.goal()],
  next: "Через неделю сравним цену обращения рекламы в поиске с прежней.",
};

const replay = async (sim: SimulationDriver, calls: ConstructorParameters<typeof ReplayPolicy>[0][number]["calls"]): Promise<ToolResult[]> => {
  await runAgentTurn({ ...sim.ctx, agent: new ReplayPolicy([{ trigger: { kind: "daily_review" }, calls }]) }, "b1", { kind: "daily_review" });
  return ((await sim.store.turns("b1")).at(-1)?.calls as { result: ToolResult }[]).map((c) => c.result);
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

describeFeature(feature, ({ Scenario }) => {
  Scenario("Инсайт об отключении", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let card: InsightCardModel | undefined;
    Given("запущенная реклама с агентом, где объявление «Маникюр без записи» 14 дней тратит деньги без обращений", async () => {
      sim = await evaluated();
    });
    When("агент разбирает рекламу", async () => {
      await runAgentTurn({ ...sim.ctx, agent: new HeuristicPolicy() }, "b1", { kind: "daily_review" });
      card = (await cards(sim)).find((c) => c.decision.text === "Отключили объявление «Маникюр без записи»");
    });
    Then("в ленте есть инсайт от автора «Сервис»: что заметили — объявление «Маникюр без записи» тратит деньги", () => {
      expect(card?.author).toBe("agent");
      expect(card?.observation).toMatch(/^Объявление «Маникюр без записи» за 14 дней потратило/);
    });
    And("на каких данных — расход и обращения объявления за 14 дней и цель", () => {
      expect(card?.facts.map((f) => f.label)).toEqual(["Объявление «Маникюр без записи»: расход за 14 дней", "Объявление «Маникюр без записи»: обращения за 14 дней", "Цель"]);
      expect(card?.facts[1]?.value).toBe("0");
      expect(plain(card?.facts[2]?.value)).toBe("800 ₽ за обращение");
    });
    And("что решили — «Отключили объявление «Маникюр без записи»», применено, с кнопкой «Вернуть как было»", () => {
      expect(card?.decision.status).toBe("applied");
      expect(card?.rollback).not.toBeNull();
    });
    And("что дальше — чего сервис ждёт от решения и когда проверит результат", () => {
      expect(card?.next).toMatch(/^Деньги перейдут к объявлениям, которые приводят обращения/);
      expect(card?.next).toMatch(/через неделю/);
    });
  });

  Scenario("Наблюдение без действия", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let entriesBefore = 0;
    Given("запущенная реклама с агентом, где объявление «Маникюр без записи» 14 дней тратит деньги без обращений", async () => {
      sim = await evaluated();
      entriesBefore = (await sim.store.changes("b1")).length;
    });
    When("агент отмечает, что данных для решения мало, и ничего не меняет", async () => {
      const results = await replay(sim, [
        { command: null, insight: { ...insight, reasonCode: "WATCH", observation: "Реклама на сайтах-партнёрах только начала приводить обращения.", decision: "Пока ничего не меняем — меньше 7 дней данных." } },
      ]);
      expect(results[0]?.status).not.toBe("rejected");
    });
    Then("в ленте есть инсайт «Что решили: пока ничего не меняем — меньше 7 дней данных» с «Что дальше»", async () => {
      const [card] = await cards(sim);
      expect(card?.decision).toEqual({ text: "Пока ничего не меняем — меньше 7 дней данных.", status: "none" });
      expect(card?.next).not.toBe("");
      expect(card?.rollback).toBeNull();
    });
    And("в истории изменений нет новых записей", async () => {
      expect(await sim.store.changes("b1")).toHaveLength(entriesBefore);
    });
  });

  Scenario("Число не из снимка", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let results: ToolResult[] = [];
    Given("запущенная реклама с агентом, где объявление «Маникюр без записи» 14 дней тратит деньги без обращений", async () => {
      sim = await evaluated();
    });
    When("агент отключает объявление с текстом «объявление потратило 3 000 ₽»", async () => {
      results = await replay(sim, [{ command: { type: "PauseAd", adId: BAD_AD }, insight: { ...insight, observation: "Объявление потратило 3 000 ₽ без обращений." } }]);
    });
    Then("инсайт и действие отклоняются с причиной «число 3 000 ₽ не найдено в данных»", async () => {
      expect(results[0]).toMatchObject({ status: "rejected", code: "INSIGHT_INVALID", message: "число 3 000 ₽ не найдено в данных" });
      // Only the marks of the quiet mornings are there: the refused insight was not saved.
      expect((await sim.store.insights("b1")).filter((i) => i.reasonCode !== QUIET_DAY_CODE)).toEqual([]);
    });
    And("объявление продолжает работать", async () => {
      expect((await sim.store.ads("b1")).find((a) => a.id === BAD_AD)?.status).toBe("active");
    });
  });

  Scenario("Факта нет в данных", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    let results: ToolResult[] = [];
    Given("запущенная реклама с агентом, где объявление «Маникюр без записи» 14 дней тратит деньги без обращений", async () => {
      sim = await evaluated();
    });
    When("агент ссылается на факт «обращения по вечерам»", async () => {
      results = await replay(sim, [{ command: { type: "PauseAd", adId: BAD_AD }, insight: { ...insight, factKeys: [factKey.goal(), `ad:${BAD_AD}:leads:evening`] } }]);
    });
    Then("инсайт отклоняется с причиной «таких данных у сервиса нет»", () => {
      expect(results[0]).toMatchObject({ status: "rejected", code: "INSIGHT_INVALID" });
      expect(results[0]?.message).toMatch(/^таких данных у сервиса нет/);
    });
  });

  Scenario("Значение берётся из снимка", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    Given("запущенная реклама с агентом, где объявление «Маникюр без записи» 14 дней тратит деньги без обращений", async () => {
      sim = await evaluated();
    });
    When("агент ссылается на расход объявления за 14 дней, не называя числа", async () => {
      await replay(sim, [{ command: { type: "PauseAd", adId: BAD_AD }, insight }]);
    });
    Then("карточка показывает расход из снимка хода", async () => {
      const snapshot = ((await sim.store.turns("b1")).at(-1)?.context as { snapshot: TurnSnapshot }).snapshot;
      const spend = snapshot.facts.find((f) => f.key === factKey.ad(BAD_AD, "spend", "14d"));
      expect(spend?.value).toBeGreaterThan(0);
      const [card] = await cards(sim);
      expect(plain(card?.facts[0]?.value)).toBe(`${(spend?.value ?? 0).toLocaleString("ru-RU").replace(/\s/g, " ")} ₽`);
    });
  });

  Scenario("Правило сработало вместо агента", ({ Given, And, When, Then }) => {
    let sim: SimulationDriver;
    Given("запущенная реклама с агентом, где объявление «Маникюр без записи» тратит деньги без обращений", async () => {
      sim = await launchedWorld(30_000, { agent: new QuietPolicy() });
    });
    And("агент делает ходы, но объявление не трогает", () => undefined);
    When("проходит 14 дней", async () => {
      await sim.runDays(14);
    });
    Then("лента показывает инсайт об отключении с автором «Сервис, страховочное правило», фактами расхода и обращений за 14 дней и цели и кнопкой «Вернуть как было»", async () => {
      const card = (await cards(sim)).find((c) => c.decision.text === "Отключили объявление «Маникюр без записи»");
      expect(card?.author).toBe("rule");
      expect(card?.facts.map((f) => f.label)).toEqual(["Объявление «Маникюр без записи»: расход за 14 дней", "Объявление «Маникюр без записи»: обращения за 14 дней", "Цель"]);
      expect(card?.rollback).not.toBeNull();
      // The agent's turn took place that day: the rules acted as its backup, the next day after the evaluation.
      const change = (await sim.store.changes("b1")).find((c) => c.objectId === BAD_AD && c.actor === "safety_net");
      expect(change?.insightId).toBe(card?.id);
    });
  });

  Scenario("Подстройка лимита — не инсайт", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    Given("запущенная реклама с бюджетом 6 000 ₽ в месяц", async () => {
      sim = await launchedWorld(6_000, { agent: new QuietPolicy(), withBadAd: false });
    });
    When("проходит 7 дней, и защита бюджета снижает недельные лимиты под остаток месяца", async () => {
      await sim.runDays(7);
    });
    Then("в ленте нет инсайтов о подстройке лимитов, а в истории подстройки есть", async () => {
      const fits = (await sim.store.changes("b1")).filter(isBudgetAdjustment);
      expect(fits.length).toBeGreaterThan(0);
      const ids = new Set(fits.map((c) => c.id));
      expect((await sim.store.insights("b1")).some((i) => i.decision.changeIds.some((id) => ids.has(id)))).toBe(false);
    });
  });

  Scenario("Ход с решениями", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    Given("запущенная реклама с агентом, где объявление «Маникюр без записи» 14 дней тратит деньги без обращений", async () => {
      sim = await evaluated();
    });
    When("агент в ежедневном ходе отключает объявление", async () => {
      await runAgentTurn({ ...sim.ctx, agent: new HeuristicPolicy() }, "b1", { kind: "daily_review" });
    });
    Then("лента показывает разбор этого дня с сообщением агента и инсайтом под ним", async () => {
      const [today] = await feed(sim);
      expect(today?.summary).toBe("Разобрал рекламу: отключил объявление, которое не приводит клиентов.");
      expect(today?.quiet).toBe(false);
      expect(today?.insights.some((c) => c.decision.text === "Отключили объявление «Маникюр без записи»")).toBe(true);
    });
  });

  Scenario("Сервис без помощника", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    Given("запущенная реклама, где у бизнеса помощник включён, а сервис запущен без помощника", async () => {
      sim = await launchedWorld(30_000, { agent: new IdlePolicy() });
      expect(await sim.store.getFlag("agent_enabled", "b1")).toBe(true);
    });
    When("проходит 14 дней", async () => {
      await sim.runDays(14);
    });
    Then("разбор дня говорит «Сегодня решения принимали страховочные правила: помощник не подключён», а не «помощник выключен»", async () => {
      const reasons = (await feed(sim)).map((d) => d.rulesReason).filter((r): r is string => r !== null);
      expect(reasons).toContain("Сегодня решения принимали страховочные правила: помощник не подключён");
      expect(reasons.some((r) => r.includes("помощник выключен"))).toBe(false);
    });
  });

  Scenario("Период без помощника", ({ Given, When, Then }) => {
    let w: OwnerWorld;
    Given("реклама в симуляции, а сервис запущен без помощника", async () => {
      w = await ownerWorld(new IdlePolicy());
    });
    When("владелец вносит статистику за дни 1–7", async () => {
      await w.enter(7);
    });
    Then("запись правил говорит «Решения за эти дни принимали страховочные правила: помощник не подключён», без слова «Сегодня»", async () => {
      const rules = (await w.store.insights("b1")).filter((i) => i.reasonCode === RULES_DAY_CODE).map((i) => i.observation);
      expect(rules).toEqual(["Решения за эти дни принимали страховочные правила: помощник не подключён"]);
    });
  });

  Scenario("Агент недоступен", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    Given("запущенная реклама, где объявление «Маникюр без записи» тратит деньги без обращений, а Agents API недоступен", async () => {
      sim = await launchedWorld(30_000, { agent: new FailingPolicy() });
    });
    When("проходит 14 дней", async () => {
      await sim.runDays(14);
    });
    Then("разбор дня говорит «Сегодня решения принимали страховочные правила: помощник был недоступен», а инсайты правил стоят под ним", async () => {
      const day = (await feed(sim)).find((d) => d.insights.some((c) => c.decision.text === "Отключили объявление «Маникюр без записи»"));
      expect(day?.rulesReason).toBe("Сегодня решения принимали страховочные правила: помощник был недоступен");
      expect(day?.insights.every((c) => c.author === "rule")).toBe(true);
    });
  });

  Scenario("Из истории к инсайту", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    let change: ChangeEntry | undefined;
    Given("запущенная реклама с агентом, где объявление «Маникюр без записи» 14 дней тратит деньги без обращений", async () => {
      sim = await evaluated();
    });
    When("агент отключает это объявление, и пользователь открывает запись истории об этом", async () => {
      await replay(sim, [{ command: { type: "PauseAd", adId: BAD_AD }, insight }]);
      change = (await sim.store.changes("b1")).find((c) => c.objectId === BAD_AD && c.actor === "agent");
    });
    Then("по ссылке «Почему» видно инсайт этого решения с фактами, а инсайт ссылается на эту запись", async () => {
      const record = (await sim.store.insights("b1")).find((i) => i.id === change?.insightId);
      expect(record?.facts).toHaveLength(3);
      expect(record?.decision.changeIds).toEqual([change?.id]);
    });
  });

  Scenario("Переход к настоящему запуску", ({ Given, When, Then }) => {
    let world: Awaited<ReturnType<typeof simulatedBusiness>>;
    Given("реклама в симуляции, где агент уже принимал решения", async () => {
      world = await simulatedBusiness(new HeuristicPolicy(), 2);
      expect((await world.store.insights("b1")).some((i) => i.source === "agent")).toBe(true);
    });
    When("пользователь нажимает «Запустить по-настоящему»", async () => {
      await controlSimulation(world.ctx, "b1", { action: "go_real" });
    });
    Then("инсайты симуляции удалены вместе с её историей", async () => {
      expect(await world.store.insights("b1")).toEqual([]);
      expect(await world.store.changes("b1")).toEqual([]);
      expect(await feed(world)).toEqual([]);
    });
  });

  Scenario("Тихие дни подряд", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    Given("запущенная реклама с агентом, которая только начала собирать данные", async () => {
      sim = await launchedWorld(30_000, { agent: new QuietPolicy() });
    });
    When("четыре дня подряд поводов для хода нет, и страховочные правила ничего не делают", async () => {
      await sim.runDays(4);
    });
    Then("лента показывает одну строку «С 1 по 4 октября — посмотрели рекламу, менять ничего не нужно» вместо четырёх разборов", async () => {
      const days = feedDays({ insights: await sim.store.insights("b1"), turns: await sim.store.turnDigests("b1"), timeZone: "Europe/Moscow", since: null, entries: new Map() });
      expect(days.map((d) => [d.from, d.date, d.quiet, d.insights.length])).toEqual([["2026-10-01", "2026-10-04", true, 0]]);
      expect(QUIET_DAYS).toBe("посмотрели рекламу, менять ничего не нужно");
    });
  });
});
