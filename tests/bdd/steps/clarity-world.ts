import { HeuristicPolicy } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { controlSimulation, launchSimulation, SimulationDriver } from "@impuls/worker";
import { buildWeekStory } from "../../../apps/web/src/lib/week-story";
import { buildDecisionScreen } from "../../../apps/web/src/lib/simulation-screen";
import type { HistoryItem } from "../../../apps/web/src/lib/history-view";

export const clarityWorld = async () => {
  const driver = new SimulationDriver({ start: new Date("2026-10-30T06:00:00Z"), seed: 202, agent: new HeuristicPolicy() });
  const business = await driver.launchBusiness({ id: "clarity", launchedOn: "2026-10-30", monthlyBudgetRub: 15_000, csoSource: { kind: "auto", reference: rubles(500) }, directions: [] });
  await driver.store.saveBusiness({ ...business, launchedOn: null });
  await launchSimulation(driver.ctx, business.id, {
    landingUrl: "https://example.test/", city: "Москва", directions: [
      { name: "Маникюр — Поиск", channel: "search", weeklyLimitRub: 1620, keywords: ["маникюр"], negativeKeywords: [], ads: [{ title: "Первое", text: "Маникюр" }, { title: "Второе", text: "Маникюр" }] },
      { name: "Маникюр — Сайты-партнёры", channel: "network", weeklyLimitRub: 1080, keywords: [], negativeKeywords: [], ads: [{ title: "Третье", text: "Маникюр" }] },
    ],
  }, "dead_ad");
  const record = async () => {
    const result = await driver.store.getSimulation(business.id);
    if (!result) throw new Error("Simulation missing");
    return result;
  };
  const screen = async () => buildDecisionScreen({ simulation: await record(), timeZone: business.timeZone, monthlyBudgetRub: business.monthlyBudgetRub, directions: await driver.store.directions(business.id), changes: await driver.store.changes(business.id), observed: await driver.store.stats(business.id, "2026-11-01", "2026-12-31") });
  const story = async (week = 1, history: HistoryItem[] = []) => buildWeekStory({ simulation: await record(), week, timeZone: business.timeZone, directions: [], ads: [], stats: [], cso: rubles(500), truthOf: () => null, reviews: [], history, changes: [], comparison: null });
  const next = () => controlSimulation(driver.ctx, business.id, { action: "step_week" });
  return { driver, business, record, screen, story, next };
};
