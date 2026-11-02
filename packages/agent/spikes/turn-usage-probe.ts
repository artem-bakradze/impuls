/**
 * Probe for add-agent-insights task 1.1: where the Agents API reports the token usage of a completed turn — on the
 * terminal turn event (`usage`, `turn.usage`), from `sessions.turns.retrieve` or from `sessions.retrieve`. One short
 * turn without tools; the session is deleted at the end. Prints usage objects and ids only, never the key.
 *
 *   set -a; . ./.env.local; set +a
 *   OPENAI_AGENT_MODEL=gpt-6-luna pnpm --filter @impuls/agent exec tsx spikes/turn-usage-probe.ts
 */
import OpenAI from "openai";
import type { AgentSessionEvent } from "openai/resources/beta/agents/agents";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_AGENT_MODEL;
if (!apiKey || !model) {
  throw new Error(`${!apiKey ? "OPENAI_API_KEY" : "OPENAI_AGENT_MODEL"} is required for the usage probe`);
}

const client = new OpenAI({ apiKey, maxRetries: 0 });
const PURPOSE = "impuls-usage-probe";

const main = async (): Promise<void> => {
  let sessionId: string | null = null;
  let turnId: string | null = null;
  const report: Record<string, unknown> = { model };
  try {
    const stream = await client.beta.agents.sessions.create({
      agent: { model, instructions: "Отвечай одним коротким предложением по-русски." },
      environment: { type: "none" },
      input: "Скажи, что разбор рекламы закончен.",
      metadata: { purpose: PURPOSE },
      stream: true,
    });
    for await (const event of stream as AsyncIterable<AgentSessionEvent>) {
      if (event.type === "agent.session.created") sessionId = event.session.id;
      if (event.type === "agent.session.turn.completed" || event.type === "agent.session.turn.failed" || event.type === "agent.session.turn.cancelled") {
        turnId = event.turn_id;
        report.terminalEvent = event.type;
        report.eventUsage = "usage" in event ? event.usage : null;
        report.eventTurnUsage = "turn" in event ? (event.turn as { usage?: unknown }).usage ?? null : null;
      }
      if (event.type === "agent.session.idle" && turnId !== null) break;
    }
    if (sessionId !== null && turnId !== null) {
      report.retrieveTurnUsage = (await client.beta.agents.sessions.turns.retrieve(turnId, { session_id: sessionId })).usage;
      report.retrieveSessionUsage = (await client.beta.agents.sessions.retrieve(sessionId)).usage;
      // «Best-effort, recorded usage may change»: a second look a few seconds later.
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      report.retrieveTurnUsageLater = (await client.beta.agents.sessions.turns.retrieve(turnId, { session_id: sessionId })).usage;
    }
  } finally {
    if (sessionId !== null) report.deleted = (await client.beta.agents.sessions.delete(sessionId)).deleted;
  }
  console.log(JSON.stringify(report, null, 2));
};

await main();
