import { WEEKLY_REVIEW_INSTRUCTIONS_VERSION } from "@impuls/agent";
import type { AgentRuntime, TurnResult, TurnTrigger } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config";
import type { AgentCosts } from "./context";
import { SimulationDriver } from "./simulation";

/** Decides nothing but says it decides, and reports a fixed usage so the turn has a price. */
class CountingPolicy implements AgentRuntime {
  readonly instructionsVersion = "test";
  readonly decides = true;
  readonly triggers: TurnTrigger["kind"][] = [];
  constructor(readonly name: string) {}
  runTurn(input: { trigger: TurnTrigger }): Promise<TurnResult> {
    this.triggers.push(input.trigger.kind);
    return Promise.resolve({ summary: "", calls: [], usage: { inputTokens: 100_000, outputTokens: 10_000, source: "api" } });
  }
}

const costs = (inputRub: number, outputRub: number, monthlyLimitRub = 1_000): AgentCosts => ({
  inputKopecksPerMTok: inputRub * 100,
  outputKopecksPerMTok: outputRub * 100,
  monthlyLimitKopecks: monthlyLimitRub * 100,
  simulationRunLimitKopecks: monthlyLimitRub * 100,
});

const world = async (agent: AgentRuntime) => {
  // 2026-10-01 is a Thursday: the Mondays of two weeks are 10-05 and 10-12.
  const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 4, agent });
  await sim.launchBusiness({
    id: "b1",
    monthlyBudgetRub: 30_000,
    launchedOn: "2026-10-01",
    csoSource: { kind: "user", goal: rubles(800) },
    directions: [{ name: "Маникюр — Поиск", weeklyLimitRub: 2_000, ads: [{ title: "Маникюр у метро", truth: { impressionsPerDay: 800, ctr: 0.06, cr: 0.1, costPerClick: rubles(20) } }] }],
  });
  return sim;
};

const weeklyTurns = async (sim: SimulationDriver) => (await sim.store.turns("b1")).filter((t) => t.trigger === "weekly_review");

describe("weekly review (ad-agent spec «Еженедельный стратегический разбор»)", () => {
  it("runs on virtual Mondays at 07:00 business time, after the day's review, with its own instructions version", async () => {
    const agent = new CountingPolicy("policy:daily");
    const sim = await world(agent);
    await sim.runDays(14);
    const turns = await weeklyTurns(sim);
    expect(turns.map((t) => t.startedAt.toISOString())).toEqual(["2026-10-05T04:00:00.000Z", "2026-10-12T04:00:00.000Z"]);
    expect(turns[0]).toMatchObject({ runtime: "policy:daily", instructionsVersion: `test+weekly.${WEEKLY_REVIEW_INSTRUCTIONS_VERSION}`, status: "completed" });
    // The daily review of that Monday came an hour earlier.
    const daily = (await sim.store.turns("b1")).filter((t) => t.trigger === "daily_review" && t.startedAt.toISOString().startsWith("2026-10-05"));
    expect(daily.map((t) => t.startedAt.toISOString())).toEqual(["2026-10-05T03:00:00.000Z"]);
  });

  it("runs on the strategy model with its prices, within the same limits", async () => {
    const daily = new CountingPolicy("policy:daily");
    const strategist = new CountingPolicy("policy:strategist");
    const sim = await world(daily);
    sim.ctx.agentCosts = costs(10, 50);
    sim.ctx.strategist = { runtime: strategist, costs: costs(1_000, 4_000) };
    await sim.runDays(5);
    const [weekly] = await weeklyTurns(sim);
    expect(weekly).toMatchObject({ runtime: "policy:strategist", costKopecks: 14_000 });
    expect(strategist.triggers).toEqual(["weekly_review"]);
    expect(daily.triggers).not.toContain("weekly_review");
    expect((await sim.store.turns("b1")).find((t) => t.trigger === "daily_review")?.costKopecks).toBe(150);
  });

  it("does not start when the month's model spend is used up", async () => {
    const sim = await world(new CountingPolicy("policy:daily"));
    // The daily turns cost 1.5 ₽ each: a limit of 3 ₽ is used up before Monday.
    sim.ctx.agentCosts = costs(10, 50, 3);
    sim.ctx.strategist = { runtime: new CountingPolicy("policy:strategist"), costs: costs(1_000, 4_000, 3) };
    await sim.runDays(5);
    expect(await weeklyTurns(sim)).toEqual([]);
  });

  it("refuses a strategy model without its prices", () => {
    const base = {
      DATABASE_URL: "postgres://x",
      DIRECT_API_MODE: "simulator",
      CREATIVES: "template",
      SMTP_URL: "smtp://localhost:1025",
      MAIL_FROM: "Импульс <noreply@impuls.test>",
      APP_URL: "https://app.example",
      TEAM_ALERT_EMAIL: "team@impuls.test",
      MINISITE_DIR: "/tmp/minisites",
      AGENT_RUNTIME: "openai",
      OPENAI_API_KEY: "k",
      OPENAI_AGENT_MODEL: "gpt-6-luna",
      AGENT_PRICE_INPUT_RUB_PER_MTOK: "10",
      AGENT_PRICE_OUTPUT_RUB_PER_MTOK: "50",
      AGENT_MONTHLY_LIMIT_RUB: "50",
      AGENT_SIMULATION_RUN_LIMIT_RUB: "30",
    };
    expect(() => loadConfig({ ...base, OPENAI_STRATEGY_MODEL: "gpt-6.1-sol" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, OPENAI_STRATEGY_MODEL: "gpt-6.1-sol", AGENT_STRATEGY_PRICE_INPUT_RUB_PER_MTOK: "250" })).toThrow(/AGENT_STRATEGY_PRICE_OUTPUT_RUB_PER_MTOK/);
    expect(loadConfig({ ...base, OPENAI_STRATEGY_MODEL: "gpt-6.1-sol", AGENT_STRATEGY_PRICE_INPUT_RUB_PER_MTOK: "250", AGENT_STRATEGY_PRICE_OUTPUT_RUB_PER_MTOK: "1000" }).OPENAI_STRATEGY_MODEL).toBe("gpt-6.1-sol");
    expect(() => loadConfig({ ...base, AGENT_RUNTIME: "heuristic", OPENAI_STRATEGY_MODEL: "gpt-6.1-sol", AGENT_STRATEGY_PRICE_INPUT_RUB_PER_MTOK: "250", AGENT_STRATEGY_PRICE_OUTPUT_RUB_PER_MTOK: "1000" })).toThrow(/OPENAI_STRATEGY_MODEL/);
  });
});
