/**
 * Agent eval on request (testing-harness spec): `pnpm eval:agent` runs the real agent and calls OpenAI (paid);
 * `pnpm eval:agent --dry-run` runs the same scenarios with the deterministic heuristic policy instead, for free.
 * With OPENAI_STRATEGY_MODEL the weekly reviews run on it, as in the deployment. `--report <file>` writes what the agent
 * did day by day; with the prices set (AGENT_PRICE_*, and AGENT_STRATEGY_PRICE_* for the strategy model) the model
 * spend of the run is printed too.
 */
import { writeFileSync } from "node:fs";
import { HeuristicPolicy, OpenAiAgentRuntime } from "@impuls/agent";
import type { AgentRuntime } from "@impuls/agent";
import { evalVerdict, runAgentEval } from "./agent-eval";
import type { EvalRun } from "./agent-eval";

const dryRun = process.argv.includes("--dry-run");
const proxyUrl = process.env.OPENAI_PROXY_URL;

const agentFor = (): AgentRuntime => {
  if (dryRun) {
    return new HeuristicPolicy();
  }
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_AGENT_MODEL;
  if (!apiKey || !model) {
    throw new Error(`${!apiKey ? "OPENAI_API_KEY" : "OPENAI_AGENT_MODEL"} is required for the agent eval; use --dry-run to check the harness for free`);
  }
  return new OpenAiAgentRuntime({ apiKey, model, ...(proxyUrl ? { proxyUrl } : {}) });
};

/** The weekly review's model of the deployment; none in a dry run, where the heuristic policy reviews the week itself. */
const strategistFor = (): AgentRuntime | undefined => {
  const model = process.env.OPENAI_STRATEGY_MODEL;
  const apiKey = process.env.OPENAI_API_KEY;
  if (dryRun || !model) {
    return undefined;
  }
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for the agent eval");
  }
  return new OpenAiAgentRuntime({ apiKey, model, ...(proxyUrl ? { proxyUrl } : {}) });
};

const reportIndex = process.argv.indexOf("--report");
const reportPath = reportIndex === -1 ? null : process.argv[reportIndex + 1];
if (reportIndex !== -1 && !reportPath) {
  throw new Error("--report needs a file path");
}
const price = (name: string): number => Number(process.env[name] ?? Number.NaN);
const daily = { input: price("AGENT_PRICE_INPUT_RUB_PER_MTOK"), output: price("AGENT_PRICE_OUTPUT_RUB_PER_MTOK") };
const strategist = strategistFor();
// Without a strategy model the weekly reviews run on the daily model and cost as much.
const weekly = strategist === undefined ? daily : { input: price("AGENT_STRATEGY_PRICE_INPUT_RUB_PER_MTOK"), output: price("AGENT_STRATEGY_PRICE_OUTPUT_RUB_PER_MTOK") };

const results = await runAgentEval(agentFor(), undefined, undefined, strategist);
const rub = (kopecks: number | null): string => (kopecks === null ? "—" : `${Math.round(kopecks / 100)} ₽`);
const tokens = (run: EvalRun) => ({
  dailyIn: run.inputTokens - run.weeklyInputTokens,
  dailyOut: run.outputTokens - run.weeklyOutputTokens,
  weeklyIn: run.weeklyInputTokens,
  weeklyOut: run.weeklyOutputTokens,
});
const spend = (t: ReturnType<typeof tokens>): string =>
  [daily.input, daily.output, weekly.input, weekly.output].every(Number.isFinite)
    ? `, model ≈${((t.dailyIn * daily.input + t.dailyOut * daily.output + t.weeklyIn * weekly.input + t.weeklyOut * weekly.output) / 1_000_000).toFixed(2)} ₽`
    : "";
for (const r of results) {
  const a = r.withAgent;
  console.log(
    `${r.scenario}${r.analyst ? " [analyst]" : ""}: with agent ${rub(a.costPerLead)} per lead (${a.leads} leads, ${a.rejectedActions} refused), ` +
      `without ${rub(r.withoutAgent.costPerLead)} (${r.withoutAgent.leads} leads); insights at once ${a.firstTryInsights ?? "—"}, ` +
      `hypotheses at once ${a.firstTryHypotheses ?? "—"}, valid reviews ${a.validSummaries ?? "—"}; ` +
      `${a.turns} turns, ${a.inputTokens} in / ${a.outputTokens} out tokens${spend(tokens(a))}`,
  );
}
const verdict = evalVerdict(results);
const total = results.reduce(
  (sum, r) => {
    const t = tokens(r.withAgent);
    return { dailyIn: sum.dailyIn + t.dailyIn, dailyOut: sum.dailyOut + t.dailyOut, weeklyIn: sum.weeklyIn + t.weeklyIn, weeklyOut: sum.weeklyOut + t.weeklyOut };
  },
  { dailyIn: 0, dailyOut: 0, weeklyIn: 0, weeklyOut: 0 },
);
console.log(`total: ${total.dailyIn + total.weeklyIn} in / ${total.dailyOut + total.weeklyOut} out tokens${spend(total)}`);
console.log(JSON.stringify({ ...verdict, results: results.map((r) => ({ ...r, withAgent: { ...r.withAgent, journal: undefined }, withoutAgent: { ...r.withoutAgent, journal: undefined } })) }, null, 2));
if (reportPath) {
  writeFileSync(reportPath, JSON.stringify(results.map((r) => ({ scenario: r.scenario, journal: r.withAgent.journal })), null, 2));
}
if (!verdict.enableAgent) {
  process.exitCode = 1;
}
