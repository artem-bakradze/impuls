import { IdlePolicy } from "@impuls/agent";
import { rubles, validateInsight } from "@impuls/core";
import { describe, expect, it } from "vitest";
import { RULES_DAY_CODE } from "./change-kinds";
import { SimulationDriver } from "./simulation";

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
    // Without the agent every day the rules decided on is marked with the reason, as the heading of its review.
    expect(all.find((i) => i.reasonCode === RULES_DAY_CODE)?.observation).toBe("Сегодня решения принимали страховочные правила: помощник выключен");
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
