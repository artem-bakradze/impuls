/**
 * Spike 0.6 (bootstrap-ad-autopilot-mvp): one agent turn per session on the OpenAI Agents API with environment
 * `none`, caller-executed function tools, the event stream, turn cancellation and session deletion.
 * Writes nothing but the console; sessions are deleted at the end.
 *
 *   set -a; . ./.env.local; set +a
 *   OPENAI_AGENT_MODEL=gpt-6.1-sol pnpm --filter @impuls/agent exec tsx spikes/agents-api-spike.ts
 */
import OpenAI from "openai";
import type { AgentSessionEvent } from "openai/resources/beta/agents/agents";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_AGENT_MODEL;
if (!apiKey || !model) {
  throw new Error(`${!apiKey ? "OPENAI_API_KEY" : "OPENAI_AGENT_MODEL"} is required for the Agents API spike`);
}

const client = new OpenAI({ apiKey });
// `spend_control` is in SDK 7.45.1 but the API answered 400 «Unknown parameter» on 2026-10-29; not used.

/** A snapshot shaped like the real agent context (allowlisted fields only, no personal data). */
const snapshot = {
  business: { category: "Маникюрный салон", area: "Москва, м. Профсоюзная", hours: "Пн–Вс 10:00–22:00" },
  goal: { costPerLeadRub: 800 },
  directions: [
    {
      id: "d1",
      name: "Маникюр — Поиск",
      weeklyLimitRub: 2_000,
      ads: [
        { id: "a1", title: "Маникюр у метро", class: "effective", spend14Rub: 3_100, leads14: 6 },
        { id: "a2", title: "Маникюр без записи", class: "ineffective", spend14Rub: 2_600, leads14: 0 },
      ],
    },
  ],
};

const tools = [
  {
    type: "function" as const,
    name: "get_snapshot",
    description: "Текущее состояние рекламы бизнеса: направления, объявления, классы эффективности, расходы и обращения за 14 дней.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function" as const,
    name: "pause_ad",
    description: "Поставить объявление на паузу. Сервис сам проверит ограничители и может отклонить действие.",
    parameters: {
      type: "object",
      properties: { adId: { type: "string" }, justification: { type: "string", description: "Почему, с цифрами, простым языком" } },
      required: ["adId", "justification"],
      additionalProperties: false,
    },
  },
];

const instructions =
  "Ты ведёшь рекламу малого бизнеса в Яндекс Директе только через инструменты сервиса. " +
  "Сначала вызови get_snapshot. Неэффективные объявления ставь на паузу через pause_ad. " +
  "В конце одним абзацем объясни владельцу, что сделал, без рекламного жаргона.";

const runTool = (name: string, args: unknown): unknown => {
  if (name === "get_snapshot") {
    return snapshot;
  }
  if (name === "pause_ad") {
    return { status: "applied", args };
  }
  return { status: "rejected", reason: `unknown tool ${name}` };
};

interface TurnLog {
  sessionId: string;
  eventTypes: string[];
  toolCalls: { name: string; args: unknown }[];
  outcome: string;
  text: string;
  ms: number;
  usage: unknown;
}

/**
 * Creates a session with the first input and follows its events. Function calls are answered by the SDK's
 * `toolHandlers`: it replies on `turn.item.added` and retries «Unknown pending tool call» until the call is
 * registered. Answering later by hand (on `turn.item.done`) never reached the model in the first run.
 */
const runTurn = async (input: string, cancelAfterStart: boolean): Promise<TurnLog> => {
  const started = Date.now();
  const log: TurnLog = { sessionId: "", eventTypes: [], toolCalls: [], outcome: "unknown", text: "", ms: 0, usage: null };
  const handler = (name: string) => (args: Record<string, unknown>) => {
    log.toolCalls.push({ name, args });
    return runTool(name, args) as object;
  };
  const stream = await client.beta.agents.sessions.create({
    agent: { model, instructions, tools },
    environment: { type: "none" },
    input,
    metadata: { purpose: "impuls-spike-0.6" },
    stream: true,
    toolHandlers: { get_snapshot: handler("get_snapshot"), pause_ad: handler("pause_ad") },
  });
  for await (const event of stream as AsyncIterable<AgentSessionEvent>) {
    log.eventTypes.push(event.type);
    if (event.type === "agent.session.created") {
      log.sessionId = event.session.id;
    }
    if (event.type === "agent.session.turn.in_progress" && cancelAfterStart && log.sessionId) {
      await client.beta.agents.sessions.events.create(log.sessionId, { events: [{ type: "agent.session.input.cancel" }] });
    }
    if (event.type === "agent.session.turn.output_text.done") {
      log.text += `${event.text}\n`;
    }
    if (event.type === "agent.session.turn.completed" || event.type === "agent.session.turn.failed" || event.type === "agent.session.turn.cancelled") {
      log.outcome = event.type;
      log.usage = "turn" in event ? (event.turn as { usage?: unknown }).usage ?? null : null;
    }
    if (event.type === "agent.session.failed") {
      log.outcome = `session.failed: ${JSON.stringify(event).slice(0, 300)}`;
      break;
    }
    if (event.type === "agent.session.idle" && log.outcome !== "unknown") {
      break;
    }
  }
  log.ms = Date.now() - started;
  return log;
};

const main = async (): Promise<void> => {
  const results: (TurnLog | { error: string })[] = [];
  const sessions: string[] = [];
  for (const cancel of [false, true]) {
    try {
      const result = await runTurn("Ежедневная оценка рекламы. Действуй по инструкции.", cancel);
      sessions.push(result.sessionId);
      results.push(result);
    } catch (error) {
      results.push({ error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
    }
  }
  // Sessions of failed turns are found by metadata and deleted too.
  for await (const session of client.beta.agents.sessions.list()) {
    if (session.metadata?.purpose === "impuls-spike-0.6" && !sessions.includes(session.id)) {
      sessions.push(session.id);
    }
  }
  for (const id of sessions) {
    const deleted = await client.beta.agents.sessions.delete(id);
    console.log("deleted", id, deleted.deleted);
  }
  for (const result of results) {
    console.log(JSON.stringify("eventTypes" in result ? { ...result, eventTypes: [...new Set(result.eventTypes)] } : result, null, 2));
  }
};

await main();
