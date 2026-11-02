import { rubles } from "@impuls/core";
import { evalVerdict } from "@impuls/worker";
import type { EvalResult, EvalRun, SimulationDriver } from "@impuls/worker";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";
import { salon } from "./analyst-world";
import type { AdTruth } from "./analyst-world";
import { featurePath } from "./world";

const feature = await loadFeature(featurePath("testing-harness/segments.feature"), { language: "ru" });

/**
 * 30% of the traffic is «бесплатно» without leads. The limit does not hold the ad back, so a week brings a hundred leads
 * or so and the comparison of two weeks is not decided by the market's noise.
 */
const freeTruth: AdTruth = {
  impressionsPerDay: 6_000,
  ctr: 0.05,
  cr: 0.04,
  costPerClick: rubles(20),
  queries: [
    { text: "маникюр москва", share: 0.7, crFactor: 1.4 },
    { text: "маникюр бесплатно", share: 0.3, crFactor: 0 },
  ],
};

const run = (costPerLead: number): EvalRun => ({
  spend: costPerLead * 100,
  leads: 100,
  costPerLead,
  rejectedActions: 0,
  firstTryInsights: 1,
  validSummaries: 1,
  firstTryHypotheses: 1,
  turns: 30,
  inputTokens: 0,
  outputTokens: 0,
  weeklyInputTokens: 0,
  weeklyOutputTokens: 0,
  journal: [],
});

describeFeature(feature, ({ Scenario }) => {
  Scenario("Минус-фраза в симуляторе", ({ Given, When, Then, And }) => {
    let sim: SimulationDriver;
    let campaignId = "";
    const total = async (from: string, to: string) => {
      const rows = await sim.platform.getStats([campaignId], from, to);
      return rows.reduce((s, r) => ({ spend: s.spend + r.spend, leads: s.leads + r.leads }), { spend: 0, leads: 0 });
    };
    Given("в рекламе 30% показов приходится на запросы со словом «бесплатно», которые не приводят обращений", async () => {
      sim = await salon({ days: 7, truth: freeTruth, weeklyLimitRub: 100_000, monthlyBudgetRub: 450_000 });
      campaignId = (await sim.store.directions("b1"))[0]?.platformCampaignId ?? "";
      const free = (await sim.platform.getBreakdown([campaignId], "2026-10-01", "2026-10-07", "query")).find((q) => q.segment === "маникюр бесплатно");
      expect(free?.leads).toBe(0);
    });
    When("агент на 8-й день добавляет минус-фразу «бесплатно»", async () => {
      const result = await sim.executor.execute({
        businessId: "b1",
        command: { type: "AddNegativeKeywords", directionId: "b1-d1", phrases: ["бесплатно"] },
        actor: "agent",
        reasonCode: "NEGATIVE_JUNK_QUERY",
        explanation: "Запрос «маникюр бесплатно» не приводит клиентов.",
      });
      expect(result).toMatchObject({ status: "applied" });
      await sim.runDays(8);
    });
    Then("с 9-го дня расход по таким запросам — 0 ₽", async () => {
      const free = (await sim.platform.getBreakdown([campaignId], "2026-10-09", "2026-10-15", "query")).find((q) => q.segment === "маникюр бесплатно");
      expect(free?.spend ?? 0).toBe(0);
    });
    And("цена обращения рекламы за следующие 7 дней ниже, чем за предыдущие 7", async () => {
      const before = await total("2026-10-01", "2026-10-07");
      const after = await total("2026-10-09", "2026-10-15");
      expect(after.spend / after.leads).toBeLessThan(before.spend / before.leads);
    });
  });

  Scenario("Разрез согласован с итогом", ({ Given, When, Then }) => {
    let sim: SimulationDriver;
    let campaignId = "";
    let devices: Awaited<ReturnType<SimulationDriver["platform"]["getBreakdown"]>> = [];
    Given("симулятор отработал неделю", async () => {
      sim = await salon({ days: 7 });
      campaignId = (await sim.store.directions("b1"))[0]?.platformCampaignId ?? "";
    });
    When("симулятор отдаёт разрез по устройствам за любой день", async () => {
      devices = await sim.platform.getBreakdown([campaignId], "2026-10-04", "2026-10-04", "device");
    });
    Then("сумма расходов, переходов и обращений по устройствам равна дневной статистике этого дня", async () => {
      const sum = (rows: readonly { spend: number; clicks: number; leads: number }[]) =>
        rows.reduce((s, r) => ({ spend: s.spend + r.spend, clicks: s.clicks + r.clicks, leads: s.leads + r.leads }), { spend: 0, clicks: 0, leads: 0 });
      expect(sum(devices)).toEqual(sum(await sim.platform.getStats([campaignId], "2026-10-04", "2026-10-04")));
    });
  });

  Scenario("Агент не нашёл мусорные запросы", ({ Given, When, Then }) => {
    let results: EvalResult[] = [];
    let verdict: ReturnType<typeof evalVerdict>;
    Given("в сценарии «мусорные запросы» цена обращения с агентом — 95% от прогона на правилах", () => {
      results = [
        { scenario: "Маникюрный салон", analyst: false, withAgent: run(50_000), withoutAgent: run(50_000) },
        { scenario: "Доставка цветов: мусорные запросы", analyst: true, withAgent: run(47_500), withoutAgent: run(50_000) },
      ];
    });
    When("eval подводит итог", () => {
      verdict = evalVerdict(results);
    });
    Then("правило выпуска не выполнено, и новая версия не выпускается", () => {
      expect(verdict).toMatchObject({ analystWithAgent: 47_500, analystWithoutAgent: 50_000, enableAgent: false });
    });
  });
});
