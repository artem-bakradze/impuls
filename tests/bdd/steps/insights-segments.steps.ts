import type { ToolResult } from "@impuls/agent";
import { addDays, factKey } from "@impuls/core";
import type { InsightRecord, SimulationDriver } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { factLabel, factValue, feedDays } from "../../../apps/web/src/lib/insights-model";
import type { WeeklyReviewModel } from "../../../apps/web/src/lib/insights-model";
import { agentTurn, factOf, rowOf, salon } from "./analyst-world";
import { featurePath } from "./world";

const feature = await loadFeature(featurePath("insights/segments.feature"), { language: "ru" });

describeFeature(feature, ({ Scenario }) => {
  Scenario("Инсайт о мусорном запросе", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let insight: InsightRecord | undefined;
    Given("агент запросил разрез по поисковым запросам", async () => {
      sim = await salon();
    });
    When("агент отминусовал «бесплатно» по запросу «маникюр бесплатно»", async () => {
      await agentTurn(sim, async (tools) => {
        const row = rowOf(await tools.breakdown("b1-d1", "query"), "маникюр бесплатно");
        await tools.act(
          { type: "AddNegativeKeywords", directionId: "b1-d1", phrases: ["бесплатно"] },
          {
            reasonCode: "NEGATIVE_JUNK_QUERY",
            observation: "Запрос «маникюр бесплатно» тратит деньги и не приводит клиентов.",
            factKeys: [factOf(row, "spend"), factOf(row, "leads"), factKey.goal()],
            next: "Через неделю проверим, подешевело ли обращение.",
          },
        );
      });
      insight = (await sim.store.insights("b1")).find((i) => i.reasonCode === "NEGATIVE_JUNK_QUERY");
    });
    Then("инсайт показывает факты «Реклама в поиске, запрос «маникюр бесплатно»: расход за 14 дней» и «…: обращения за 14 дней» с нулём", () => {
      const facts = (insight?.facts ?? []).map((f) => [factLabel(f), factValue(f)]);
      expect(facts[0]?.[0]).toBe("Реклама в поиске, запрос «маникюр бесплатно»: расход за 14 дней");
      expect(facts[1]).toEqual(["Реклама в поиске, запрос «маникюр бесплатно»: обращения за 14 дней", "0"]);
    });
    And("инсайт показывает цель", () => {
      expect(insight?.facts.at(-1)?.metric).toBe("goal");
    });
  });

  Scenario("Сегмент не запрашивали", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    let result: ToolResult | null = null;
    Given("агент в этом ходе не запрашивал разрез по устройствам", async () => {
      sim = await salon();
    });
    When("агент ссылается на обращения с планшетов", async () => {
      await agentTurn(sim, async (tools) => {
        result = await tools.observe({
          reasonCode: "TABLETS",
          observation: "С планшетов клиентов нет.",
          factKeys: [factKey.segment("b1-d1", "device", "tablet", "leads"), factKey.goal()],
          next: "Посмотрим через неделю.",
          decision: "Пока ничего не меняем.",
        });
      });
    });
    Then("инсайт отклоняется с причиной «таких данных у сервиса нет»", () => {
      expect(result).toMatchObject({ status: "rejected", code: "INSIGHT_INVALID" });
      expect((result as { message: string } | null)?.message).toContain("таких данных у сервиса нет");
    });
  });

  Scenario("Разбор недели с планом", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let phonesId = "";
    let weekly: WeeklyReviewModel | null | undefined;
    // 2026-10-12 is a Monday.
    const monday = "2026-10-12";
    Given("открыта гипотеза о дорогих телефонах", async () => {
      sim = await salon({ days: 4 });
      await agentTurn(sim, async (tools) => {
        const saved = await tools.saveHypothesis({
          statement: "С телефонов клиенты обходятся дороже",
          factKeys: [factKey.goal(), factKey.budget("budget_left")],
          check: "Через неделю сравним цену обращения",
          checkOn: "2026-10-12",
          status: "checking",
        });
        phonesId = saved.status === "applied" ? saved.id : "";
      });
      await sim.runDays(7);
    });
    When("в понедельник агент закрывает её с результатом и открывает гипотезу «Запросы со словом «обучение» не приводят клиентов» с проверкой через неделю", async () => {
      await agentTurn(
        sim,
        async (tools) => {
          const queries = await tools.breakdown("b1-d1", "query");
          const training = rowOf(queries, "маникюр обучение");
          expect(
            await tools.saveHypothesis({
              id: phonesId,
              statement: "С телефонов клиенты обходятся дороже",
              factKeys: [factKey.direction("b1-d1", "cost_per_lead", "14d"), factKey.goal()],
              check: "Через неделю сравним цену обращения",
              checkOn: monday,
              status: "confirmed",
              result: "Обращение с телефонов действительно дороже цели.",
            }),
          ).toMatchObject({ status: "applied" });
          expect(
            await tools.saveHypothesis({
              statement: "Запросы со словом «обучение» не приводят клиентов",
              factKeys: [factOf(training, "spend"), factOf(training, "leads")],
              check: "Через неделю посмотрим, были ли обращения по этим запросам",
              checkOn: addDays(monday, 7),
              status: "checking",
            }),
          ).toMatchObject({ status: "applied" });
        },
        { kind: "weekly_review" },
      );
      const days = feedDays({
        insights: await sim.store.insights("b1"),
        turns: await sim.store.turnDigests("b1"),
        timeZone: "Europe/Moscow",
        since: null,
        entries: new Map(),
        hypotheses: await sim.store.hypotheses("b1"),
      });
      weekly = days.find((d) => d.date === monday)?.weekly;
    });
    Then("лента показывает «Разбор недели»: в «Выяснили» — гипотезу о телефонах с результатом", () => {
      expect(weekly?.found).toEqual([expect.objectContaining({ statement: "С телефонов клиенты обходятся дороже", outcome: "подтвердилась", result: "Обращение с телефонов действительно дороже цели." })]);
    });
    And("в «Проверяем» — новую гипотезу с днём проверки через неделю", () => {
      expect(weekly?.checking).toEqual([expect.objectContaining({ statement: "Запросы со словом «обучение» не приводят клиентов", checkOn: "2026-10-19" })]);
    });
  });
});
