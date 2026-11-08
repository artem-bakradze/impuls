import { HeuristicPolicy, WEEKLY_REVIEW_INSTRUCTIONS_VERSION } from "@impuls/agent";
import type { AgentRuntime, BreakdownAnswer, HypothesisDraft, HypothesisResult, ToolResult } from "@impuls/agent";
import { addDays, factKey } from "@impuls/core";
import { ACTION_META, RULES_DAY_CODE } from "@impuls/worker";
import type { SimulationDriver } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { describeDiff } from "../../../apps/web/src/lib/history-view";
import { factLabel, feedDays } from "../../../apps/web/src/lib/insights-model";
import { agentEntries, agentTurn, breakdownOf, factOf, rowOf, salon, salonNames, trafficOf } from "./analyst-world";
import { featurePath } from "./world";

const feature = await loadFeature(featurePath("ad-agent/analyst.feature"), { language: "ru" });

/** The heuristic policy under another name: the weekly review's own model in the BDD world. */
const strategist = (): AgentRuntime => {
  const heuristic = new HeuristicPolicy();
  return { name: "policy:strategist", instructionsVersion: "test", decides: true, runTurn: (input) => heuristic.runTurn(input) };
};

/** A daily runtime with a fixed model spend per turn, so the month's limit runs out. */
const paidHeuristic = (): AgentRuntime => {
  const heuristic = new HeuristicPolicy();
  return {
    name: "policy:paid",
    instructionsVersion: "test",
    decides: true,
    runTurn: async (input) => ({ ...(await heuristic.runTurn(input)), usage: { inputTokens: 100_000, outputTokens: 10_000, source: "api" } }),
  };
};

const phonesHypothesis = (factKeys: string[], today: string): HypothesisDraft => ({
  statement: "С телефонов клиенты обходятся дороже",
  factKeys,
  check: "Через 7 дней сравним цену обращения с телефонов и компьютеров",
  checkOn: addDays(today, 7),
  status: "checking",
});

describeFeature(feature, ({ Scenario }) => {
  Scenario("Мусорный запрос виден агенту", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let answer: BreakdownAnswer;
    Given("за 14 дней по запросу «маникюр бесплатно» потрачено больше цели и нет ни одного обращения", async () => {
      sim = await salon();
    });
    When("агент запрашивает разрез рекламы по поисковым запросам", async () => {
      answer = await breakdownOf(sim, "query");
    });
    Then("строка «маникюр бесплатно» получает вердикт «дороже цели»", () => {
      const row = rowOf(answer, "маникюр бесплатно");
      expect(row.leads).toBe(0);
      expect(row.spendRub).toBeGreaterThan(500);
      expect(row.verdict).toBe("дороже цели");
    });
    And("агент может сослаться на её расход и обращения как на факты инсайта", async () => {
      let result: ToolResult | null = null;
      await agentTurn(sim, async (tools) => {
        const row = rowOf(await tools.breakdown("b1-d1", "query"), "маникюр бесплатно");
        result = await tools.observe({
          reasonCode: "JUNK_QUERY",
          observation: `По запросу «маникюр бесплатно» потратили ${row.spendRub} ₽ и не получили ни одного обращения.`,
          factKeys: [factOf(row, "spend"), factOf(row, "leads"), factKey.goal()],
          next: "Вернёмся к нему на следующем разборе.",
          decision: "Пока только наблюдаем.",
        });
      });
      expect(result).toEqual({ status: "applied", message: "инсайт сохранён" });
    });
  });

  Scenario("Запрос с номером телефона не уходит в модель", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let answer: BreakdownAnswer;
    Given("среди поисковых запросов рекламы есть «маникюр 89161234567» с несколькими переходами", async () => {
      sim = await salon();
      const [direction] = await sim.store.directions("b1");
      const rows = await sim.platform.getBreakdown([direction?.platformCampaignId ?? ""], "2026-10-02", "2026-10-15", "query");
      expect(rows.find((r) => r.segment === "маникюр 89161234567")?.clicks).toBeGreaterThan(2);
    });
    When("агент запрашивает разрез рекламы по поисковым запросам", async () => {
      answer = await breakdownOf(sim, "query");
    });
    Then("этого запроса нет в ответе инструмента", () => {
      expect(JSON.stringify(answer)).not.toContain("89161234567");
    });
    And("в ответе указано, что 1 запрос скрыт", () => {
      expect(answer).toMatchObject({ status: "ok", hidden: 1 });
    });
  });

  Scenario("По устройству мало данных", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    let answer: BreakdownAnswer;
    Given("у рекламы с планшетов несколько переходов и ни одного обращения", async () => {
      sim = await salon({ days: 2 });
    });
    When("агент запрашивает разрез рекламы по устройствам", async () => {
      answer = await breakdownOf(sim, "device");
    });
    Then("строка «планшеты» получает вердикт «собираем данные»", () => {
      const tablets = rowOf(answer, "планшеты");
      expect(tablets.leads).toBe(0);
      expect(tablets.clicks).toBeLessThan(20);
      expect(tablets.verdict).toBe("собираем данные");
    });
  });

  Scenario("Агент минусует мусорный запрос", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let result: ToolResult | null = null;
    Given("разрез показывает запрос «маникюр бесплатно» с вердиктом «дороже цели»", async () => {
      sim = await salon();
      expect(rowOf(await breakdownOf(sim, "query"), "маникюр бесплатно").verdict).toBe("дороже цели");
    });
    When("агент добавляет минус-фразу «бесплатно» с инсайтом на фактах этого запроса", async () => {
      await agentTurn(sim, async (tools) => {
        const row = rowOf(await tools.breakdown("b1-d1", "query"), "маникюр бесплатно");
        result = await tools.act(
          { type: "AddNegativeKeywords", directionId: "b1-d1", phrases: ["бесплатно"] },
          {
            reasonCode: "NEGATIVE_JUNK_QUERY",
            observation: `По запросу «маникюр бесплатно» за 14 дней потратили ${row.spendRub} ₽ и не получили ни одного обращения.`,
            factKeys: [factOf(row, "spend"), factOf(row, "leads"), factKey.goal()],
            next: "Через неделю проверим, подешевело ли обращение.",
          },
        );
      });
      expect(result).toEqual({ status: "applied", message: "выполнено" });
    });
    Then("минус-фраза «бесплатно» появляется у рекламы в Директе", async () => {
      expect((await trafficOf(sim)).negativeKeywords).toEqual(["бесплатно"]);
    });
    And("в истории есть изменение минус-фраз «было нет → стало «бесплатно»» с кнопкой «Вернуть как было»", async () => {
      const [entry] = await agentEntries(sim, "AddNegativeKeywords");
      if (!entry) throw new Error("no history entry");
      expect(describeDiff(entry.before, entry.after, salonNames)).toEqual([{ label: "Фразы-исключения", before: "нет", after: "«бесплатно»" }]);
      expect(ACTION_META.AddNegativeKeywords.reversible).toBe(true);
      expect(entry.insightId).not.toBeNull();
    });
    And("в ленте есть инсайт «Добавили минус-фразу «бесплатно»» с расходом и обращениями этого запроса", async () => {
      const insight = (await sim.store.insights("b1")).find((i) => i.reasonCode === "NEGATIVE_JUNK_QUERY");
      expect(insight?.decision.text).toMatch(/^Добавили минус-фразу «бесплатно»/);
      expect(insight?.facts.map(factLabel)).toEqual(
        expect.arrayContaining(["Реклама в поиске, запрос «маникюр бесплатно»: расход за 14 дней", "Реклама в поиске, запрос «маникюр бесплатно»: обращения за 14 дней"]),
      );
    });
  });

  Scenario("Обращения с телефонов дороже", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let result: ToolResult | null = null;
    Given("за 14 дней обращение с телефонов дороже цели, а с компьютеров — в цели", async () => {
      sim = await salon();
      const devices = await breakdownOf(sim, "device");
      expect(rowOf(devices, "телефоны").verdict).toBe("дороже цели");
      expect(rowOf(devices, "компьютеры").verdict).toBe("в цели");
    });
    When("агент снижает цену перехода с телефонов на 25% с инсайтом на ценах обращения обоих устройств и цели", async () => {
      await agentTurn(sim, async (tools) => {
        const devices = await tools.breakdown("b1-d1", "device");
        const phones = rowOf(devices, "телефоны");
        const computers = rowOf(devices, "компьютеры");
        result = await tools.act(
          { type: "SetDeviceAdjustment", directionId: "b1-d1", device: "mobile", percent: -25 },
          {
            reasonCode: "DEVICE_EXPENSIVE",
            observation: `Обращение с телефонов стоит ${phones.costPerLeadRub ?? 0} ₽, с компьютеров — ${computers.costPerLeadRub ?? 0} ₽. Снижаем цену перехода с телефонов на 25%.`,
            factKeys: [factOf(phones, "cost_per_lead"), factOf(computers, "cost_per_lead"), factKey.goal()],
            next: "Через неделю сравним цену обращения по устройствам.",
          },
        );
      });
    });
    Then("корректировка −25% для телефонов применяется", async () => {
      expect(result).toEqual({ status: "applied", message: "выполнено" });
      expect((await trafficOf(sim)).deviceAdjustments).toEqual({ mobile: -25, desktop: 0 });
    });
    And("инсайт показывает обе цены обращения и цель", async () => {
      const insight = (await sim.store.insights("b1")).find((i) => i.reasonCode === "DEVICE_EXPENSIVE");
      expect(insight?.facts.map(factLabel)).toEqual(["Реклама в поиске, с телефонов: цена обращения за 14 дней", "Реклама в поиске, с компьютеров: цена обращения за 14 дней", "Цель"]);
    });
  });

  Scenario("Понедельник", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    Given("агент включён, лимит затрат не исчерпан, а для разбора недели задана своя модель", async () => {
      sim = await salon({ days: 0, agent: new HeuristicPolicy() });
      sim.ctx.strategist = { runtime: strategist(), costs: { inputKopecksPerMTok: 0, outputKopecksPerMTok: 0, monthlyLimitKopecks: 100_000, simulationRunLimitKopecks: 100_000 } };
    });
    When("наступает понедельник 07:00 по времени бизнеса", async () => {
      // 2026-10-01 is a Thursday: Monday 10-05 07:00 in Moscow is 04:00 UTC.
      await sim.runHours(4 * 24 + 4);
    });
    Then("выполняется ход «разбор недели» на модели для стратегии", async () => {
      const weekly = (await sim.store.turns("b1")).filter((t) => t.trigger === "weekly_review");
      expect(weekly.map((t) => [t.startedAt.toISOString(), t.runtime, t.status])).toEqual([["2026-10-05T04:00:00.000Z", "policy:strategist", "completed"]]);
    });
    And("в журнале хода записаны модель и версия инструкций разбора недели", async () => {
      const weekly = (await sim.store.turns("b1")).find((t) => t.trigger === "weekly_review");
      expect(weekly?.instructionsVersion).toBe(`test+weekly.${WEEKLY_REVIEW_INSTRUCTIONS_VERSION}`);
    });
    And("в ленте появляется «Разбор недели» хотя бы с одной гипотезой в «Проверяем»", async () => {
      const days = feedDays({
        insights: await sim.store.insights("b1"),
        turns: await sim.store.turnDigests("b1"),
        timeZone: "Europe/Moscow",
        since: null,
        entries: new Map(),
        hypotheses: await sim.store.hypotheses("b1"),
      });
      const monday = days.find((d) => d.date === "2026-10-05");
      expect(monday?.weekly?.checking.length).toBeGreaterThan(0);
    });
  });

  Scenario("Лимит исчерпан", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    Given("затраты на модель за месяц достигли лимита до понедельника", async () => {
      sim = await salon({ days: 0, agent: paidHeuristic() });
      // The month's limit is used up already: without reasons there are no daily turns to spend it before Monday.
      sim.ctx.agentCosts = { inputKopecksPerMTok: 1_000, outputKopecksPerMTok: 5_000, monthlyLimitKopecks: 0, simulationRunLimitKopecks: 0 };
    });
    When("наступает понедельник 07:00 по времени бизнеса", async () => {
      await sim.runHours(4 * 24 + 4);
    });
    Then("разбор недели не начинается", async () => {
      expect((await sim.store.turns("b1")).filter((t) => t.trigger === "weekly_review")).toEqual([]);
    });
    And("в этот день решения принимают страховочные правила", async () => {
      const marker = (await sim.store.insights("b1")).find((i) => i.reasonCode === RULES_DAY_CODE && i.createdAt.toISOString().startsWith("2026-10-05"));
      expect(marker?.observation).toContain("лимит расходов на помощника исчерпан");
    });
  });

  Scenario("Гипотеза открыта", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    let saved: HypothesisResult | null = null;
    Given("обращение с телефонов стоит дороже, чем с компьютеров", async () => {
      sim = await salon();
    });
    When("агент записывает гипотезу «С телефонов клиенты обходятся дороже» с проверкой через 7 дней", async () => {
      await agentTurn(sim, async (tools) => {
        const devices = await tools.breakdown("b1-d1", "device");
        saved = await tools.saveHypothesis(phonesHypothesis([factOf(rowOf(devices, "телефоны"), "cost_per_lead"), factOf(rowOf(devices, "компьютеры"), "cost_per_lead")], "2026-10-15"));
      });
      expect(saved).toMatchObject({ status: "applied" });
    });
    Then("в журнале появляется гипотеза в статусе «проверяем» с фактами о телефонах и компьютерах и днём проверки", async () => {
      const [hypothesis] = await sim.store.hypotheses("b1");
      expect(hypothesis).toMatchObject({ statement: "С телефонов клиенты обходятся дороже", status: "checking", checkOn: "2026-10-22" });
      expect(hypothesis?.facts.map((f) => f.object)).toEqual(["реклама в поиске, с телефонов", "реклама в поиске, с компьютеров"]);
    });
  });

  Scenario("Гипотеза закрыта", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let id = "";
    Given("агент записал гипотезу о дорогих телефонах и снизил цену перехода с телефонов", async () => {
      // 2026-10-12 is a Monday: the next weekly review is a week later.
      sim = await salon({ days: 11 });
      await agentTurn(sim, async (tools) => {
        const devices = await tools.breakdown("b1-d1", "device");
        const phones = rowOf(devices, "телефоны");
        const saved = await tools.saveHypothesis(phonesHypothesis([factOf(phones, "cost_per_lead"), factKey.goal()], "2026-10-12"));
        id = saved.status === "applied" ? saved.id : "";
        await tools.act(
          { type: "SetDeviceAdjustment", directionId: "b1-d1", device: "mobile", percent: -25 },
          { reasonCode: "DEVICE_EXPENSIVE", observation: "С телефонов обращение обходится дороже цели.", factKeys: [factOf(phones, "cost_per_lead"), factKey.goal()], next: "Через неделю сравним." },
        );
      });
      expect(id).not.toBe("");
    });
    When("через 7 дней на разборе недели агент закрывает гипотезу с результатом на фактах цены обращения рекламы", async () => {
      await sim.runDays(7);
      await agentTurn(
        sim,
        async (tools) => {
          const result = await tools.saveHypothesis({
            ...phonesHypothesis([factKey.direction("b1-d1", "cost_per_lead", "14d"), factKey.goal()], "2026-10-12"),
            id,
            status: "confirmed",
            result: "Цена обращения рекламы осталась ниже цели.",
          });
          expect(result).toMatchObject({ status: "applied", message: "гипотеза закрыта" });
        },
        { kind: "weekly_review" },
      );
    });
    Then("гипотеза получает статус «подтвердилась» с результатом", async () => {
      expect((await sim.store.hypotheses("b1"))[0]).toMatchObject({ status: "confirmed", result: "Цена обращения рекламы осталась ниже цели." });
    });
    And("«Разбор недели» показывает её в «Выяснили»", async () => {
      const days = feedDays({
        insights: await sim.store.insights("b1"),
        turns: await sim.store.turnDigests("b1"),
        timeZone: "Europe/Moscow",
        since: null,
        entries: new Map(),
        hypotheses: await sim.store.hypotheses("b1"),
      });
      const review = days.find((d) => d.weekly !== null);
      expect(review?.weekly?.found.map((h) => [h.statement, h.outcome])).toEqual([["С телефонов клиенты обходятся дороже", "подтвердилась"]]);
    });
  });

  Scenario("Слишком много открытых гипотез", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    let eleventh: HypothesisResult | null = null;
    const facts = [factKey.goal(), factKey.budget("budget_left")];
    Given("у бизнеса 10 открытых гипотез", async () => {
      sim = await salon({ days: 3 });
      await agentTurn(sim, async (tools) => {
        for (let i = 0; i < 10; i++) {
          expect((await tools.saveHypothesis(phonesHypothesis(facts, "2026-10-04"))).status).toBe("applied");
        }
      });
    });
    When("агент записывает одиннадцатую", async () => {
      await agentTurn(sim, async (tools) => {
        eleventh = await tools.saveHypothesis(phonesHypothesis(facts, "2026-10-04"));
      });
    });
    Then("вызов отклоняется с причиной «сначала закройте одну из открытых гипотез»", () => {
      expect(eleventh).toEqual({ status: "rejected", code: "HYPOTHESIS_LIMIT", message: "сначала закройте одну из открытых гипотез" });
    });
  });
});
