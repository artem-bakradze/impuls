import OpenAI, { ConflictError } from "openai";
import type { AgentSessionEvent, TokenUsage } from "openai/resources/beta/agents/agents";
import { ProxyAgent } from "undici";
import { AGENT_INSTRUCTIONS_VERSION, instructionsFor } from "./instructions";
import type { AgentRuntime, AgentToolbox, ToolCallRecord, TurnResult, TurnSnapshot, TurnTrigger, TurnUsage } from "./runtime";
import { isActionTool, parseActionCall, parseHypothesisCall, parseObservationCall, toolDefinitions } from "./tools";

export interface OpenAiAgentRuntimeOptions {
  apiKey: string;
  /** e.g. gpt-6.1-sol (docs/research/agents-api.md). */
  model: string;
  /** Optional HTTPS proxy for egress from hosts where OpenAI is not reachable directly. */
  proxyUrl?: string;
  /** Test seam: replaces the HTTP layer (recorded-event contract tests). */
  fetch?: typeof fetch;
  /** Test seam: sees every event of the turn (used to record fixtures). */
  onEvent?: (event: AgentSessionEvent) => void;
}

/** Read, observation and journal tools this runtime offers: everything the worker's toolbox can serve (no history yet). */
const OFFERED_TOOLS = new Set(["get_snapshot", "get_recent_insights", "report_insight", "get_breakdown", "get_hypotheses", "save_hypothesis"]);

/**
 * Characters per token for the estimate when the Agents API has no usage for a turn: Russian text with JSON is
 * about 2.5–3 characters per token, so 2 counts more tokens than were used (a margin, add-agent-insights decision 7).
 */
const CHARS_PER_TOKEN = 2;

const fromApi = (usage: TokenUsage | null | undefined): TurnUsage | null =>
  usage && Number.isFinite(usage.input_tokens) && Number.isFinite(usage.output_tokens) ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, source: "api" } : null;

const TRIGGER_TEXT: Record<TurnTrigger["kind"], string> = {
  launch: "Реклама только что запущена. Проверь, что всё настроено разумно; результатов ещё нет.",
  daily_review: "Ежедневная оценка рекламы.",
  weekly_review: "Понедельник: разбор недели.",
  moderation_rejected: "Директ отклонил объявления.",
  experiment_finished: "Закончились A/B-проверки.",
  settings_changed: "Владелец изменил цель, бюджет или настройки.",
};

const triggerInput = (trigger: TurnTrigger): string => {
  const details = "adIds" in trigger ? ` Объявления: ${trigger.adIds.join(", ")}.` : "experimentIds" in trigger ? ` Проверки: ${trigger.experimentIds.join(", ")}.` : "";
  return `${TRIGGER_TEXT[trigger.kind]}${details} Действуй по инструкции.`;
};

/** JSON schema without the `$schema` key, as the Agents API expects function parameters. */
const parameters = (schema: unknown): Record<string, unknown> => {
  const json = { ...(schema as Record<string, unknown>) };
  delete json.$schema;
  return json;
};

const isCancellationConflict = (error: unknown): boolean => error instanceof ConflictError;

/**
 * `AgentRuntime` on the OpenAI Agents API (design decision 14, spike 0.6): one session per turn with environment
 * `none`, our function tools answered through the SDK `toolHandlers`, cancellation by `agent.session.input.cancel`,
 * and the session deleted when the turn ends, whatever the outcome.
 */
export class OpenAiAgentRuntime implements AgentRuntime {
  readonly name: string;
  readonly instructionsVersion = AGENT_INSTRUCTIONS_VERSION;
  readonly decides = true;
  private readonly client: OpenAI;

  constructor(private readonly options: OpenAiAgentRuntimeOptions) {
    if (!options.apiKey || !options.model) {
      throw new Error("OpenAI API key and agent model are required for the Agents API runtime");
    }
    this.name = `openai-agents:${options.model}`;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      // No SDK retries: it retries 409/5xx, which would re-create a streaming session (a second turn) or resend a
      // tool result to a cancelled turn. A failed turn is retried by the worker's turn scheduling instead.
      maxRetries: 0,
      ...(options.fetch !== undefined && { fetch: options.fetch }),
      ...(options.proxyUrl !== undefined && { fetchOptions: { dispatcher: new ProxyAgent(options.proxyUrl) } }),
    });
  }

  async runTurn(input: { trigger: TurnTrigger; snapshot: TurnSnapshot; tools: AgentToolbox; signal: AbortSignal }): Promise<TurnResult> {
    const { trigger, snapshot, tools, signal } = input;
    const calls: ToolCallRecord[] = [];
    const definitions = toolDefinitions().filter((tool) => isActionTool(tool.name) || OFFERED_TOOLS.has(tool.name));
    const instructions = instructionsFor(trigger);
    // The usage estimate when the API has none (docs/research/agents-api.md): every model step reads the conversation
    // so far — instructions, tools, the trigger, the calls, their answers and the texts — and writes its call or text.
    let context = instructions.text.length + JSON.stringify(definitions).length + triggerInput(trigger).length;
    let readChars = context;
    let writtenChars = 0;
    let toolCalls = 0;
    const toolUse: Record<string, number> = {};
    const answer = (result: object): object => {
      context += JSON.stringify(result).length;
      return result;
    };
    const handlers: Record<string, (args: Record<string, unknown>) => Promise<object>> = {
      get_snapshot: () => Promise.resolve(answer(snapshot)),
      get_recent_insights: async () => answer({ insights: await tools.recentInsights() }),
      get_breakdown: async (args) =>
        answer(await tools.breakdown(typeof args.directionId === "string" ? args.directionId : "", args.dimension === "device" ? "device" : "query")),
      get_hypotheses: async () => answer({ hypotheses: await tools.hypotheses() }),
      save_hypothesis: async (args) => {
        const parsed = parseHypothesisCall(args);
        return answer(parsed.ok ? await tools.saveHypothesis(parsed.draft) : { status: "rejected", code: "INVALID_ARGUMENTS", message: parsed.message });
      },
      report_insight: async (args) => {
        const parsed = parseObservationCall(args);
        if (!parsed.ok) {
          return answer({ status: "rejected", code: "INVALID_ARGUMENTS", message: parsed.message });
        }
        const result = await tools.observe(parsed.insight);
        calls.push({ command: null, insight: parsed.insight, result });
        return answer(result);
      },
    };
    for (const tool of definitions.filter((t) => isActionTool(t.name))) {
      handlers[tool.name] = async (args) => {
        const parsed = parseActionCall(tool.name, args);
        if (!parsed.ok) {
          // Refusals are results, not thrown errors: a thrown handler reaches the model only as «Tool handler failed».
          return answer({ status: "rejected", code: "INVALID_ARGUMENTS", message: parsed.message });
        }
        const result = await tools.act(parsed.command, parsed.insight);
        calls.push({ command: parsed.command, insight: parsed.insight, result });
        return answer(result);
      };
    }

    const counted = Object.fromEntries(
      Object.entries(handlers).map(([name, handler]) => [
        name,
        async (args: Record<string, unknown>) => {
          toolCalls++;
          toolUse[name] = (toolUse[name] ?? 0) + 1;
          writtenChars += JSON.stringify(args).length;
          context += JSON.stringify(args).length;
          const result = await handler(args);
          // The next model step reads the conversation with this answer.
          readChars += context;
          return result;
        },
      ]),
    );

    let sessionId: string | null = null;
    let turnId: string | null = null;
    let usage: TurnUsage | null = null;
    // The day review is the message after the last tool call; what the model said before it (its plan) is not.
    let summary = "";
    let callsAtText = toolCalls;
    let cancelled = false;
    const cancel = async (): Promise<void> => {
      cancelled = true;
      if (sessionId !== null) {
        await this.client.beta.agents.sessions.events.create(sessionId, { events: [{ type: "agent.session.input.cancel" }] }).catch((error: unknown) => {
          if (!isCancellationConflict(error)) throw error;
        });
      }
    };
    const onAbort = () => void cancel();
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      const stream = await this.client.beta.agents.sessions.create({
        agent: {
          model: this.options.model,
          instructions: instructions.text,
          tools: definitions.map((tool) => ({ type: "function" as const, name: tool.name, description: tool.description, parameters: parameters(tool.parameters) })),
        },
        environment: { type: "none" },
        input: triggerInput(trigger),
        metadata: { purpose: "impuls-turn", instructions: instructions.version },
        stream: true,
        toolHandlers: counted,
      });
      try {
        for await (const event of stream as AsyncIterable<AgentSessionEvent>) {
          this.options.onEvent?.(event);
          if (event.type === "agent.session.created") {
            sessionId = event.session.id;
            if (signal.aborted) await cancel();
          }
          if (event.type === "agent.session.turn.output_text.done") {
            writtenChars += event.text.length;
            context += event.text.length;
            summary = summary === "" || toolCalls > callsAtText ? event.text : `${summary}\n${event.text}`;
            callsAtText = toolCalls;
          }
          if (event.type === "agent.session.turn.completed" || event.type === "agent.session.turn.cancelled") {
            turnId = event.turn_id;
            usage = fromApi(event.usage) ?? usage;
          }
          if (event.type === "agent.session.turn.failed" || event.type === "agent.session.failed") {
            throw new Error(`Agents API turn failed: ${JSON.stringify(event).slice(0, 500)}`);
          }
          if (event.type === "agent.session.turn.cancelled") {
            cancelled = true;
          }
        }
      } catch (error) {
        // After our own cancel the SDK may still try to answer a pending tool call: 409, the turn simply ended.
        if (!(cancelled && isCancellationConflict(error))) throw error;
      }
      if (usage === null && sessionId !== null && turnId !== null) {
        // The completed event often comes without usage; the turn itself may have it (docs/research/agents-api.md).
        usage = fromApi((await this.client.beta.agents.sessions.turns.retrieve(turnId, { session_id: sessionId })).usage);
      }
      usage ??= {
        inputTokens: Math.ceil(readChars / CHARS_PER_TOKEN),
        outputTokens: Math.ceil(writtenChars / CHARS_PER_TOKEN),
        source: "estimate",
      };
      return { summary: cancelled && summary === "" ? "Ход отменён" : summary, calls, usage, toolUse };
    } finally {
      signal.removeEventListener("abort", onAbort);
      if (sessionId !== null) {
        await this.client.beta.agents.sessions.delete(sessionId);
      }
    }
  }
}
