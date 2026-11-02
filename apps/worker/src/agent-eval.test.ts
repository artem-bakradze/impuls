import { HeuristicPolicy, IdlePolicy } from "@impuls/agent";
import { describe, expect, it } from "vitest";
import { EVAL_SCENARIOS, evalVerdict, runAgentEval } from "./agent-eval";
import type { EvalResult, EvalRun } from "./agent-eval";

const run = (costPerLead: number, overrides: Partial<EvalRun> = {}): EvalRun => ({
  spend: costPerLead * 10,
  leads: 10,
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
  ...overrides,
});
const result = (scenario: string, analyst: boolean, agent: EvalRun, rules: EvalRun): EvalResult => ({ scenario, analyst, withAgent: agent, withoutAgent: rules });

describe("agent eval", () => {
  it("has scenarios of different niches, three of them where only the analyst levers win", () => {
    expect(EVAL_SCENARIOS).toHaveLength(8);
    expect(new Set(EVAL_SCENARIOS.map((s) => s.name.split(":")[0])).size).toBe(8);
    expect(EVAL_SCENARIOS.filter((s) => s.analyst).map((s) => s.name.split(": ")[1])).toEqual([
      "мусорные запросы",
      "дорогие обращения с телефонов",
      "мусорные запросы и дорогие телефоны",
    ]);
  });

  it("asks the analyst scenarios for 10% cheaper leads and the others for no dearer ones (testing-harness spec)", () => {
    const usual = result("Маникюр", false, run(50_000), run(50_000));
    // «Агент не нашёл мусорные запросы»: 95% of the rules is not enough.
    expect(evalVerdict([usual, result("Цветы", true, run(47_500), run(50_000))])).toMatchObject({ analystWithAgent: 47_500, analystWithoutAgent: 50_000, enableAgent: false });
    expect(evalVerdict([usual, result("Цветы", true, run(45_000), run(50_000))]).enableAgent).toBe(true);
    expect(evalVerdict([result("Маникюр", false, run(51_000), run(50_000)), result("Цветы", true, run(30_000), run(50_000))]).enableAgent).toBe(false);
  });

  it("asks hypotheses, like insights and reviews, to pass the checks at once in 90% of cases", () => {
    const analyst = (share: number) => result("Цветы", true, run(30_000, { firstTryHypotheses: share }), run(50_000));
    expect(evalVerdict([analyst(0.9)]).enableAgent).toBe(true);
    expect(evalVerdict([analyst(0.8)])).toMatchObject({ firstTryHypotheses: 0.8, enableAgent: false });
  });

  it("runs a scenario with and without the agent on the same market and compares the cost per lead", async () => {
    const [scenario] = EVAL_SCENARIOS;
    if (!scenario) throw new Error("no scenarios");
    const results = await runAgentEval(new IdlePolicy(), [scenario]);
    expect(results).toHaveLength(1);
    const [result] = results;
    expect(result?.withAgent.leads).toBeGreaterThan(0);
    expect(result?.withoutAgent.leads).toBeGreaterThan(0);
    expect(result?.withAgent.rejectedActions).toBe(0);
    // The idle agent does nothing itself; the rules switch the bad ad off sooner without it.
    const verdict = evalVerdict(results);
    expect(verdict.withAgent).not.toBeNull();
    expect(verdict.enableAgent).toBe(verdict.withAgent !== null && verdict.withoutAgent !== null && verdict.withAgent <= verdict.withoutAgent);
  }, 120_000);

  it("checks that every action comes with a valid insight and the day reviews pass the checks", async () => {
    const [scenario] = EVAL_SCENARIOS;
    if (!scenario) throw new Error("no scenarios");
    const results = await runAgentEval(new HeuristicPolicy(), [scenario]);
    expect(results[0]?.withAgent.firstTryInsights).toBe(1);
    expect(results[0]?.withAgent.validSummaries).toBe(1);
    const verdict = evalVerdict(results);
    expect(verdict.firstTryInsights).toBe(1);
    expect(verdict.validSummaries).toBe(1);
  }, 120_000);
});
