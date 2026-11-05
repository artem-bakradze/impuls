import { IdlePolicy } from "@impuls/agent";
import type { AgentRuntime } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { SimulationDriver } from "@impuls/worker";
import { fileURLToPath } from "node:url";
import { ownerWorld } from "./owner-world";
import type { OwnerWorld } from "./owner-world";

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

/**
 * A business in the simulation mode with the given agent, in search and on the partner sites, after `weeks` periods of
 * the owner's typical week (simulation-mode spec «Статистика периода от владельца»); the Direct platform is never reached.
 */
export const simulatedBusiness = async (agent: AgentRuntime, weeks: number): Promise<OwnerWorld> => {
  const world = await ownerWorld(agent);
  for (let week = 0; week < weeks; week++) await world.week();
  return world;
};
