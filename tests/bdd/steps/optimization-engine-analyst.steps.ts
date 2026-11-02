import type { ToolResult } from "@impuls/agent";
import { factKey, guard, rubles } from "@impuls/core";
import type { Command, DirectionAnalystState, GuardState, SegmentStats, Verdict } from "@impuls/core";
import type { SimulationDriver } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { agentTurn, factOf, rowOf, salon } from "./analyst-world";
import { featurePath } from "./world";

const feature = await loadFeature(featurePath("optimization-engine/analyst-guards.feature"), { language: "ru" });

const segment = (name: string, clicks: number, leads: number, spendRub: number): SegmentStats => ({ segment: name, impressions: clicks * 10, clicks, leads, spend: rubles(spendRub) });

/** The current state the executor hands the guard: one search direction, a goal of 500 ₽ and a fresh breakdown. */
const state = (analyst: Partial<DirectionAnalystState>): GuardState => ({
  today: "2026-10-15",
  cso: rubles(500),
  monthBudget: rubles(30_000),
  spentMonth: rubles(10_000),
  directions: [
    {
      id: "d1",
      businessId: "b1",
      name: "Маникюр — Поиск",
      channel: "search",
      status: "active",
      weeklyLimit: rubles(3_000),
      strategyId: "WB_MAXIMUM_CLICKS",
      createdOn: "2026-10-01",
      lastLimitIncreaseOn: null,
      lastStrategyChangeOn: null,
    },
  ],
  ads: [],
  adClasses: new Map(),
  directionStats14: new Map(),
  userDecisions: [],
  strategyCatalog: ["WB_MAXIMUM_CLICKS"],
  leadGoalStrategies: [],
  hasLeadGoal: false,
  minWeeklyLimit: rubles(300),
  activeExperiments: 0,
  analyst: new Map([
    [
      "d1",
      {
        keywords: ["маникюр москва"],
        negativeKeywords: [],
        deviceAdjustments: { mobile: 0, desktop: 0 },
        deviceAdjustedOn: { mobile: null, desktop: null },
        negativeAddedToday: 0,
        queries: [segment("маникюр бесплатно", 40, 0, 800)],
        devices: [],
        ...analyst,
      },
    ],
  ]),
});

const reason = (verdict: Verdict): string => (verdict.kind === "allow" ? "" : verdict.reason.message);

const negative = (phrase: string): Command => ({ type: "AddNegativeKeywords", directionId: "d1", phrases: [phrase] });

/** The agent's adjustment of phones in a turn on the salon, with an insight on the devices' facts. */
const adjustPhones = async (sim: SimulationDriver, percent: number): Promise<ToolResult | null> => {
  let result: ToolResult | null = null;
  await agentTurn(sim, async (tools) => {
    const devices = await tools.breakdown("b1-d1", "device");
    result = await tools.act(
      { type: "SetDeviceAdjustment", directionId: "b1-d1", device: "mobile", percent },
      {
        reasonCode: "DEVICE_EXPENSIVE",
        observation: "С телефонов обращение обходится дороже цели, поэтому снижаем цену перехода с телефонов.",
        factKeys: [factOf(rowOf(devices, "телефоны"), "cost_per_lead"), factKey.goal()],
        next: "Через неделю сравним цену обращения по устройствам.",
      },
    );
  });
  return result;
};

describeFeature(feature, ({ Scenario }) => {
  Scenario("Минус-фраза из ключевой фразы", ({ Given, When, Then }) => {
    let guardState: GuardState;
    let verdict: Verdict;
    Given("у рекламы есть ключевая фраза «маникюр москва»", () => {
      guardState = state({ queries: [segment("маникюр москва недорого", 40, 0, 800)] });
    });
    When("агент пытается добавить минус-фразу «маникюр»", () => {
      verdict = guard(guardState, negative("маникюр"), "agent");
    });
    Then("действие отклоняется с причиной «эта минус-фраза отключит показы по вашим основным запросам»", () => {
      expect(verdict.kind).toBe("reject");
      expect(reason(verdict)).toBe("эта минус-фраза отключит показы по вашим основным запросам");
    });
  });

  Scenario("Запрос с обращениями в цели", ({ Given, When, Then }) => {
    let guardState: GuardState;
    let verdict: Verdict;
    Given("по запросу «маникюр недорого» за 14 дней было 2 обращения по 300 ₽ при цели 500 ₽", () => {
      guardState = state({ queries: [segment("маникюр недорого", 25, 2, 600)] });
    });
    When("агент пытается добавить минус-фразу «недорого»", () => {
      verdict = guard(guardState, negative("недорого"), "agent");
    });
    Then("действие отклоняется с причиной «этот запрос приводит обращения в цели»", () => {
      expect(reason(verdict)).toBe("этот запрос приводит обращения в цели");
    });
  });

  Scenario("Больше 10 минус-фраз за сутки", ({ Given, When, Then }) => {
    let guardState: GuardState;
    let verdict: Verdict;
    Given("агент за сутки уже добавил рекламе 10 минус-фраз", () => {
      guardState = state({ negativeAddedToday: 10 });
    });
    When("агент добавляет одиннадцатую", () => {
      verdict = guard(guardState, negative("бесплатно"), "agent");
    });
    Then("действие отклоняется с причиной «минус-фраз на сегодня достаточно, вернёмся к ним завтра»", () => {
      expect(reason(verdict)).toBe("минус-фраз на сегодня достаточно, вернёмся к ним завтра");
    });
  });

  Scenario("Слишком сильное снижение", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let result: ToolResult | null = null;
    Given("корректировка цены перехода для телефонов сейчас 0%", async () => {
      sim = await salon();
      expect((await sim.store.directions("b1"))[0]?.deviceAdjustments.mobile).toBe(0);
    });
    When("агент задаёт корректировку −80% для телефонов", async () => {
      result = await adjustPhones(sim, -80);
    });
    Then("исполнитель урезает её до −25%", async () => {
      expect(result).toEqual({ status: "clamped", message: "урезано: не больше 25 пунктов за шаг" });
      expect((await sim.store.directions("b1"))[0]?.deviceAdjustments.mobile).toBe(-25);
    });
    And("инсайт показывает «урезано: не больше 25 пунктов за шаг»", async () => {
      const insight = (await sim.store.insights("b1")).find((i) => i.reasonCode === "DEVICE_EXPENSIVE");
      expect(insight?.decision.status).toBe("clamped");
      expect(insight?.decision.text).toContain("— урезано: не больше 25 пунктов за шаг");
    });
  });

  Scenario("Мало данных по устройству", ({ Given, When, Then }) => {
    let guardState: GuardState;
    let verdict: Verdict;
    Given("по компьютерам и планшетам вместе за 14 дней 8 переходов и ни одного обращения", () => {
      guardState = state({ devices: [segment("mobile", 120, 6, 2_400), segment("desktop", 6, 0, 120), segment("tablet", 2, 0, 40)] });
    });
    When("агент снижает цену перехода с компьютеров", () => {
      verdict = guard(guardState, { type: "SetDeviceAdjustment", directionId: "d1", device: "desktop", percent: -20 }, "agent");
    });
    Then("действие отклоняется с причиной «по этому устройству ещё мало данных»", () => {
      expect(reason(verdict)).toBe("по этому устройству ещё мало данных");
    });
  });

  Scenario("Повтор раньше недели", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    let result: ToolResult | null = null;
    Given("агент изменил корректировку для телефонов", async () => {
      sim = await salon();
      expect(await adjustPhones(sim, -20)).toMatchObject({ status: "applied" });
    });
    When("через 3 дня агент меняет её снова", async () => {
      await sim.runDays(3);
      result = await adjustPhones(sim, -40);
    });
    Then("действие отклоняется с причиной «корректировку этого устройства можно менять не чаще раза в 7 дней»", () => {
      expect(result).toEqual({ status: "rejected", code: "DEVICE_COOLDOWN", message: "корректировку этого устройства можно менять не чаще раза в 7 дней" });
    });
  });
});
