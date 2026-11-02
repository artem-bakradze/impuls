import { IdlePolicy, TemplateCreativeEngine } from "@impuls/agent";
import type { AgentRuntime } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { CommandExecutor, controlSimulation, launchSimulation, ManualClock, MemoryLockManager, MemoryStore, SimulationDriver } from "@impuls/worker";
import type { JobContext, LaunchPlan } from "@impuls/worker";
import { fileURLToPath } from "node:url";

export const featurePath = (relative: string): string => fileURLToPath(new URL(`../features/${relative}`, import.meta.url));

export const goodTruth = { impressionsPerDay: 800, ctr: 0.06, cr: 0.1, costPerClick: rubles(20) };
export const noLeadsTruth = { impressionsPerDay: 800, ctr: 0.06, cr: 0, costPerClick: rubles(30) };

/** A launched business on the simulator: two directions, one of them with an ad that never brings leads. */
export const launchedWorld = async (
  monthlyBudgetRub: number,
  options: { agent?: AgentRuntime; seed?: number; withBadAd?: boolean; agentEnabled?: boolean } = {},
): Promise<SimulationDriver> => {
  const sim = new SimulationDriver({
    start: new Date("2026-10-01T00:00:00Z"),
    seed: options.seed ?? 42,
    agent: options.agent ?? new IdlePolicy(),
    ...(options.agentEnabled !== undefined ? { agentEnabled: options.agentEnabled } : {}),
  });
  await sim.launchBusiness({
    id: "b1",
    monthlyBudgetRub,
    launchedOn: "2026-10-01",
    csoSource: { kind: "user", goal: rubles(800) },
    directions: [
      {
        name: "Маникюр — Поиск",
        weeklyLimitRub: 2_000,
        ads: [
          { title: "Маникюр у метро", truth: goodTruth },
          { title: "Маникюр без записи", truth: options.withBadAd === false ? goodTruth : noLeadsTruth },
        ],
      },
      { name: "Педикюр — Поиск", weeklyLimitRub: 1_500, ads: [{ title: "Педикюр", truth: goodTruth }] },
    ],
  });
  return sim;
};

export const campaignIds = async (sim: SimulationDriver): Promise<string[]> =>
  (await sim.store.directions("b1")).map((d) => d.platformCampaignId);

const simulationPlan: LaunchPlan = {
  landingUrl: "https://nogotok.example",
  city: "Москва",
  directions: [
    { name: "Маникюр — Поиск", channel: "search", weeklyLimitRub: 2_100, keywords: ["маникюр"], negativeKeywords: [], ads: [1, 2, 3].map((i) => ({ title: `Маникюр ${i}`, text: "У метро" })) },
    { name: "Маникюр — Сайты-партнёры", channel: "network", weeklyLimitRub: 1_400, keywords: [], negativeKeywords: [], ads: [1, 2].map((i) => ({ title: `Ноготок ${i}`, text: "Запись онлайн" })) },
  ],
};

/**
 * A business in the simulation mode with the given agent, in search and on the partner sites, after `days` virtual
 * days of «Одно объявление не приносит клиентов»; the Direct platform must never be reached.
 */
export const simulatedBusiness = async (agent: AgentRuntime, days: number): Promise<{ store: MemoryStore; ctx: JobContext }> => {
  const store = new MemoryStore();
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
    card: { category: "Маникюр", services: [], area: "", hours: "Пн–Вс 10:00–20:00", advantages: [], name: "", address: "", city: "Москва", siteUrl: "https://nogotok.example" },
  });
  const clock = new ManualClock(new Date("2026-11-03T07:00:00Z"));
  const locks = new MemoryLockManager();
  const platformFor = () => {
    throw new Error("no Direct in a simulation");
  };
  const ctx: JobContext = { store, clock, locks, executor: new CommandExecutor({ store, locks, clock, platformFor }), platformFor, agent, creatives: new TemplateCreativeEngine() };
  await launchSimulation(ctx, "b1", simulationPlan, "dead_ad");
  for (let day = 0; day < days; day++) await controlSimulation(ctx, "b1", { action: "step_day" });
  return { store, ctx };
};
