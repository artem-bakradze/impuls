/**
 * One real agent turn through the worker (task 10.1 of bootstrap, task 1.1 of add-agent-insights): Agents API runtime
 * + real toolbox, insight checks, guards, executor and turn journal on the market simulator. The market is warmed up
 * for 14 days with an agent that changes nothing and the rules off, so the model faces an ad without leads and
 * advertising held back by its limit; then exactly one paid turn runs. Run on request only.
 *
 *   set -a; . ./.env.local; set +a
 *   OPENAI_AGENT_MODEL=gpt-6-luna AGENT_PRICE_INPUT_RUB_PER_MTOK=10 AGENT_PRICE_OUTPUT_RUB_PER_MTOK=50 \
 *     pnpm --filter @impuls/worker exec tsx spikes/live-agent-turn.ts [--launch]
 *
 * `--launch`: the turn right after the launch, on a business without statistics yet.
 */
import { OpenAiAgentRuntime, QuietPolicy } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { runAgentTurn } from "../src/agent-turn";
import { SimulationDriver } from "../src/simulation";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_AGENT_MODEL;
const inputPrice = Number(process.env.AGENT_PRICE_INPUT_RUB_PER_MTOK);
const outputPrice = Number(process.env.AGENT_PRICE_OUTPUT_RUB_PER_MTOK);
if (!apiKey || !model || !(inputPrice > 0) || !(outputPrice > 0)) {
  throw new Error("OPENAI_API_KEY, OPENAI_AGENT_MODEL, AGENT_PRICE_INPUT_RUB_PER_MTOK and AGENT_PRICE_OUTPUT_RUB_PER_MTOK are required for the live agent turn");
}

const good = { impressionsPerDay: 800, ctr: 0.06, cr: 0.1, costPerClick: rubles(20) };
const noLeads = { impressionsPerDay: 800, ctr: 0.06, cr: 0, costPerClick: rubles(30) };

const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 42, agent: new QuietPolicy() });
await sim.launchBusiness({
  id: "b1",
  monthlyBudgetRub: 30_000,
  launchedOn: "2026-10-01",
  csoSource: { kind: "user", goal: rubles(800) },
  directions: [
    { name: "Маникюр — Поиск", weeklyLimitRub: 2_000, ads: [{ title: "Маникюр у метро", truth: good }, { title: "Маникюр без записи", truth: noLeads }] },
    { name: "Педикюр — Поиск", weeklyLimitRub: 1_500, ads: [{ title: "Педикюр", truth: good }] },
  ],
});
const launch = process.argv.includes("--launch");
await sim.store.setFlag("automation_enabled", false, null);
if (!launch) await sim.runHours(14 * 24);

const started = Date.now();
const ctx = {
  ...sim.ctx,
  agent: new OpenAiAgentRuntime({ apiKey, model }),
  // The limits are far away: one turn.
  agentCosts: { inputKopecksPerMTok: inputPrice * 100, outputKopecksPerMTok: outputPrice * 100, monthlyLimitKopecks: 100_000, simulationRunLimitKopecks: 100_000 },
};
const outcome = await runAgentTurn(ctx, "b1", { kind: launch ? "launch" : "daily_review" });
const turn = (await sim.store.turns("b1")).find((t) => outcome.status !== "skipped" && t.id === outcome.turnId);
const calls = (turn?.calls ?? []) as { command: { type: string } | null; result: { status: string; code?: string; message: string } }[];
console.log(
  JSON.stringify(
    {
      outcome,
      ms: Date.now() - started,
      runtime: turn?.runtime,
      instructions: turn?.instructionsVersion,
      usage: { input: turn?.inputTokens, output: turn?.outputTokens, source: turn?.usageSource, costRub: (turn?.costKopecks ?? 0) / 100 },
      toolUse: (turn?.context as { toolUse?: unknown } | undefined)?.toolUse,
      summary: turn?.summary,
      summaryValid: turn?.summaryValid,
      calls: calls.map((c) => ({ command: c.command?.type ?? "report_insight", status: c.result.status, code: c.result.code, message: c.result.message })),
    },
    null,
    2,
  ),
);
const insights = await sim.store.insights("b1");
console.log(
  JSON.stringify(
    insights.map((i) => ({ observation: i.observation, facts: i.facts.map((f) => `${f.object}: ${f.metric} ${f.period} = ${f.value}`), decision: i.decision.text, status: i.decision.status, next: i.next })),
    null,
    2,
  ),
);
