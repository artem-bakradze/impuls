/**
 * One real agent turn through the worker (task 10.1): Agents API runtime + real toolbox, guards, executor and turn
 * journal on the market simulator. The simulator is warmed up for 20 days with the idle policy, then exactly one paid
 * turn runs. Run on request only (cents).
 *
 *   set -a; . ./.env.local; set +a
 *   OPENAI_AGENT_MODEL=gpt-6.1-sol pnpm --filter @impuls/worker exec tsx spikes/live-agent-turn.ts
 */
import { IdlePolicy, OpenAiAgentRuntime } from "@impuls/agent";
import { rubles } from "@impuls/core";
import { runAgentTurn } from "../src/agent-turn";
import { SimulationDriver } from "../src/simulation";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_AGENT_MODEL;
if (!apiKey || !model) {
  throw new Error(`${!apiKey ? "OPENAI_API_KEY" : "OPENAI_AGENT_MODEL"} is required for the live agent turn`);
}

const good = { impressionsPerDay: 800, ctr: 0.06, cr: 0.1, costPerClick: rubles(20) };
const noLeads = { impressionsPerDay: 800, ctr: 0.06, cr: 0, costPerClick: rubles(30) };

const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 42, agent: new IdlePolicy() });
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
await sim.runHours(20 * 24);

const started = Date.now();
const ctx = { ...sim.ctx, agent: new OpenAiAgentRuntime({ apiKey, model }) };
const outcome = await runAgentTurn(ctx, "b1", { kind: "daily_review" });
const turn = (await sim.store.turns("b1")).find((t) => outcome.status !== "skipped" && t.id === outcome.turnId);
console.log(JSON.stringify({ outcome, ms: Date.now() - started, runtime: turn?.runtime, instructions: turn?.instructionsVersion, summary: turn?.summary, calls: turn?.calls }, null, 2));
const agentChanges = (await sim.store.changes("b1")).filter((c) => c.actor === "agent");
console.log(JSON.stringify(agentChanges.map((c) => ({ action: c.action.type, status: c.status, explanation: c.explanation })), null, 2));
