import { IdlePolicy } from "@impuls/agent";
import type { AgentRuntime, AgentToolbox, BreakdownAnswer, BreakdownRowView, TurnResult, TurnTrigger } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { runAgentTurn, SimulationDriver } from "@impuls/worker";
import type { ChangeEntry, TurnOutcome } from "@impuls/worker";
import type { Names } from "../../../apps/web/src/lib/history-view";

/** The simulator's types, through the worker as the other steps reach them. */
export type AdTruth = NonNullable<ReturnType<SimulationDriver["platform"]["truthOf"]>>;
type TrafficSettings = Awaited<ReturnType<SimulationDriver["platform"]["getTrafficSettings"]>>[number];

/**
 * A manicure salon's search ad (add-agent-analyst-stage1): «бесплатно» and «обучение» never bring a client, one query
 * carries a phone number, phones bring leads several times dearer than computers, tablets bring none.
 */
export const salonTruth: AdTruth = {
  impressionsPerDay: 1_000,
  ctr: 0.06,
  cr: 0.1,
  costPerClick: rubles(20),
  queries: [
    { text: "маникюр москва", share: 0.45, crFactor: 1.5 },
    { text: "маникюр бесплатно", share: 0.25, crFactor: 0 },
    { text: "маникюр обучение", share: 0.15, crFactor: 0 },
    { text: "маникюр 89161234567", share: 0.15, crFactor: 1 },
  ],
  devices: { mobile: { share: 0.6, crFactor: 0.15 }, desktop: { share: 0.35, crFactor: 1.8 }, tablet: { share: 0.05, crFactor: 0 } },
};

/** The salon after `days` virtual days with the rules only (the agent decides nothing unless a turn is scripted). */
export const salon = async (options: { days?: number; agent?: AgentRuntime; truth?: AdTruth; weeklyLimitRub?: number; monthlyBudgetRub?: number } = {}): Promise<SimulationDriver> => {
  const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 7, agent: options.agent ?? new IdlePolicy() });
  await sim.launchBusiness({
    id: "b1",
    monthlyBudgetRub: options.monthlyBudgetRub ?? 40_000,
    launchedOn: "2026-10-01",
    csoSource: { kind: "user", goal: rubles(500) },
    directions: [{ name: "Маникюр — Поиск", weeklyLimitRub: options.weeklyLimitRub ?? 6_000, keywords: ["маникюр москва"], ads: [{ title: "Маникюр у метро", truth: options.truth ?? salonTruth }] }],
  });
  await sim.runDays(options.days ?? 14);
  return sim;
};

/** Plays a script as the agent's turn: the BDD scenarios say what the agent does, the service answers as always. */
class ScriptPolicy implements AgentRuntime {
  readonly name = "policy:script";
  readonly instructionsVersion = "test";
  readonly decides = true;
  constructor(private readonly script: (tools: AgentToolbox) => Promise<void>) {}
  async runTurn(input: { tools: AgentToolbox }): Promise<TurnResult> {
    await this.script(input.tools);
    return { summary: "", calls: [], usage: null };
  }
}

export const agentTurn = (sim: SimulationDriver, script: (tools: AgentToolbox) => Promise<void>, trigger: TurnTrigger = { kind: "daily_review" }): Promise<TurnOutcome> =>
  runAgentTurn({ ...sim.ctx, agent: new ScriptPolicy(script) }, "b1", trigger);

/** The breakdown of the salon's ad as the agent gets it in a turn. */
export const breakdownOf = async (sim: SimulationDriver, dimension: "query" | "device"): Promise<BreakdownAnswer> => {
  let answer: BreakdownAnswer | null = null;
  await agentTurn(sim, async (tools) => {
    answer = await tools.breakdown("b1-d1", dimension);
  });
  if (answer === null) throw new Error("no breakdown");
  return answer;
};

export const rowOf = (answer: BreakdownAnswer, segment: string): BreakdownRowView => {
  const row = answer.status === "ok" ? answer.rows.find((r) => r.segment === segment) : undefined;
  if (!row) throw new Error(`no row «${segment}» in the breakdown`);
  return row;
};

export const factOf = (row: BreakdownRowView, metric: string): string => `${row.factKeyPrefix}:${metric}:14d`;

export const trafficOf = async (sim: SimulationDriver): Promise<TrafficSettings> => {
  const [direction] = await sim.store.directions("b1");
  const [settings] = await sim.platform.getTrafficSettings([direction?.platformCampaignId ?? ""]);
  if (!settings) throw new Error("no traffic settings");
  return settings;
};

export const agentEntries = async (sim: SimulationDriver, type: ChangeEntry["action"]["type"]): Promise<ChangeEntry[]> =>
  (await sim.store.changes("b1")).filter((c) => c.action.type === type && c.actor === "agent");

/** Names the history screen uses for the salon. */
export const salonNames: Names = { directions: { "b1-d1": "Маникюр — Поиск" }, channels: { "b1-d1": "search" }, ads: {}, strategies: {} };

/** The cabinet change happened after the last reconciliation: the Changes cursor is moved back before it. */
export const cursorBeforeCabinetChange = async (sim: SimulationDriver): Promise<void> => {
  await sim.store.setCursor("b1", "changes", new Date(sim.clock.now().getTime() - 60_000));
};
