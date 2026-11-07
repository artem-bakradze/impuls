import { IdlePolicy } from "@impuls/agent";
import { rubles, validateInsight } from "@impuls/core";
import { describe, expect, it } from "vitest";
import { RULES_DAY_CODE } from "./change-kinds";
import { budgetFigures, periodTotalFacts } from "./insights";
import { SimulationDriver } from "./simulation";
import type { BusinessView } from "./state";

const good = { impressionsPerDay: 800, ctr: 0.06, cr: 0.1, costPerClick: rubles(20) };
const bad = { impressionsPerDay: 800, ctr: 0.06, cr: 0, costPerClick: rubles(30) };

/** Without a deciding agent the rules act on the evaluation the same day (optimization-engine spec). */
const rulesWorld = async (monthlyBudgetRub: number) => {
  const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 8, agent: new IdlePolicy() });
  await sim.launchBusiness({
    id: "b1",
    monthlyBudgetRub,
    launchedOn: "2026-10-01",
    csoSource: { kind: "user", goal: rubles(800) },
    directions: [
      { name: "Маникюр — Поиск", weeklyLimitRub: 2_000, ads: [{ title: "Маникюр у метро", truth: good }, { title: "Маникюр без записи", truth: bad }] },
      { name: "Педикюр — Поиск", weeklyLimitRub: 1_500, ads: [{ title: "Педикюр", truth: good }] },
    ],
  });
  await sim.runDays(14);
  return sim;
};

describe("insights of the rules (insights spec «Инсайты страховочных правил»)", () => {
  it("shows the safety net's pause in the insight format with the numbers it acted on", async () => {
    const sim = await rulesWorld(30_000);
    const pause = (await sim.store.insights("b1")).find((i) => i.reasonCode === "SAFETY_PAUSE_AD");
    expect(pause).toMatchObject({
      source: "rule",
      turnId: null,
      observation: "Объявление «Маникюр без записи» тратит деньги, а клиенты из него обходятся дороже цели.",
      decision: { kind: "action", status: "applied" },
      objectRef: { kind: "ad", id: "b1-d1-a2" },
    });
    expect(pause?.facts.map((f) => [f.metric, f.period, f.unit])).toEqual([["spend", "14d", "rub"], ["leads", "14d", "count"], ["goal", "now", "rub"]]);
    expect(pause?.facts[1]?.value).toBe(0);
    expect(pause?.facts[2]?.value).toBe(800);
    const entry = (await sim.store.changes("b1")).find((c) => c.id === pause?.decision.changeIds[0]);
    expect(entry).toMatchObject({ actor: "safety_net", reasonCode: "SAFETY_PAUSE_AD", insightId: pause?.id });
  });

  it("writes every rule insight in plain words on 2–4 facts it has", async () => {
    const sim = await rulesWorld(30_000);
    const all = await sim.store.insights("b1");
    // Without the agent every day the rules decided on is marked with the reason, as the heading of its review. The
    // agent is on for the business, but the service runs without one: it is not connected, not switched off.
    expect(all.find((i) => i.reasonCode === RULES_DAY_CODE)?.observation).toBe("Сегодня решения принимали страховочные правила: помощник не подключён");
    const insights = all.filter((i) => i.reasonCode !== RULES_DAY_CODE);
    expect(insights.length).toBeGreaterThan(0);
    for (const i of insights) {
      expect(validateInsight({ reasonCode: i.reasonCode, observation: i.observation, factKeys: i.facts.map((f) => f.key), next: i.next }, i.facts)).toEqual([]);
    }
  });

  it("does not turn the budget guard's limit fits into insights", async () => {
    const sim = await rulesWorld(6_000);
    const fits = (await sim.store.changes("b1")).filter((c) => c.reasonCode === "BUDGET_FIT");
    expect(fits.length).toBeGreaterThan(0);
    expect(fits.every((c) => c.insightId === null || c.insightId === undefined)).toBe(true);
    expect((await sim.store.insights("b1")).some((i) => i.reasonCode === "BUDGET_FIT")).toBe(false);
  });
});

describe("the even pace of the agent's snapshot", () => {
  const view = (mode: "direct" | "simulation"): BusinessView =>
    ({ today: "2026-12-02", monthBudget: rubles(31_000), spentMonth: rubles(1_074), business: { mode, launchedOn: "2026-12-01" } }) as unknown as BusinessView;

  it("stops at the day before in a simulation: its today is the morning after the owner's period, with no numbers yet", () => {
    // One day of 31 entered: an even spend by now is one day's share, not two.
    expect(budgetFigures(view("simulation")).evenPaceRub).toBe(1_000);
    // Direct brings today's spend during the day, so today counts.
    expect(budgetFigures(view("direct")).evenPaceRub).toBe(2_000);
  });
});

describe("the period's totals in the review's facts (ad-agent «Рассказ в разборе периода»)", () => {
  const view = {
    directions: [
      { id: "d-search", platformCampaignId: "c-search", channel: "search" },
      { id: "d-network", platformCampaignId: "c-network", channel: "network" },
    ],
  } as unknown as BusinessView;
  const row = (campaignId: string, adId: string, spendRub: number, leads: number) => ({ date: "2026-12-01", campaignId, adId, impressions: 100, clicks: 5, leads, spend: rubles(spendRub) });

  it("gives the whole advertising and each channel with spend, as «Реклама» shows the day", () => {
    const rows = [row("c-search", "a1", 188, 0), row("c-search", "a2", 237, 0), row("c-search", "a3", 220, 0), row("c-network", "n1", 147, 1), row("c-network", "n2", 136, 1), row("c-network", "n3", 146, 0)];
    expect(periodTotalFacts(view, rows).map((f) => [f.key, f.value])).toEqual([
      ["total:all:spend:period", 1_074],
      ["total:all:leads:period", 2],
      ["total:all:cost_per_lead:period", 537],
      ["channel:search:spend:period", 645],
      ["channel:search:leads:period", 0],
      ["channel:network:spend:period", 429],
      ["channel:network:leads:period", 2],
      ["channel:network:cost_per_lead:period", 215],
    ]);
    expect(periodTotalFacts(view, rows).every((f) => f.period === "period")).toBe(true);
  });

  it("has no cost per lead without leads and no channel without spend", () => {
    expect(periodTotalFacts(view, [row("c-search", "a1", 300, 0)]).map((f) => f.key)).toEqual(["total:all:spend:period", "total:all:leads:period", "channel:search:spend:period", "channel:search:leads:period"]);
  });
});
