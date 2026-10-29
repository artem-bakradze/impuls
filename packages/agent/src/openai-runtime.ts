import OpenAI, { ConflictError } from "openai";
import type { AgentSessionEvent } from "openai/resources/beta/agents/agents";
import { ProxyAgent } from "undici";
import { AGENT_INSTRUCTIONS, AGENT_INSTRUCTIONS_VERSION } from "./instructions";
import type { AgentRuntime, AgentToolbox, ToolCallRecord, TurnResult, TurnSnapshot, TurnTrigger } from "./runtime";
import { isActionTool, parseActionCall, toolDefinitions } from "./tools";

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

/** Tools this runtime offers: everything the worker's toolbox can serve (no history or note deletion yet). */
const OFFERED_TOOLS = new Set(["get_snapshot", "get_notes", "save_note"]);

const TRIGGER_TEXT: Record<TurnTrigger["kind"], string> = {
  launch: "Реклама только что запущена. Проверь, что всё настроено разумно; результатов ещё нет.",
  daily_review: "Ежедневная оценка рекламы.",
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
    const handlers: Record<string, (args: Record<string, unknown>) => Promise<object>> = {
      get_snapshot: () => Promise.resolve(snapshot),
      get_notes: () => Promise.resolve({ notes: snapshot.notes }),
      save_note: async (args) => {
        const text = typeof args.text === "string" ? args.text : "";
        if (text.trim() === "") {
          return { status: "rejected", message: "пустая заметка" };
        }
        await tools.saveNote(text);
        return { status: "saved" };
      },
    };
    for (const tool of definitions.filter((t) => isActionTool(t.name))) {
      handlers[tool.name] = async (args) => {
        const parsed = parseActionCall(tool.name, args);
        if (!parsed.ok) {
          // Refusals are results, not thrown errors: a thrown handler reaches the model only as «Tool handler failed».
          return { status: "rejected", code: "INVALID_ARGUMENTS", message: parsed.message };
        }
        const result = await tools.act(parsed.command, parsed.justification);
        calls.push({ command: parsed.command, justification: parsed.justification, result });
        return result;
      };
    }

    let sessionId: string | null = null;
    let summary = "";
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
          instructions: AGENT_INSTRUCTIONS,
          tools: definitions.map((tool) => ({ type: "function" as const, name: tool.name, description: tool.description, parameters: parameters(tool.parameters) })),
        },
        environment: { type: "none" },
        input: triggerInput(trigger),
        metadata: { purpose: "impuls-turn", instructions: AGENT_INSTRUCTIONS_VERSION },
        stream: true,
        toolHandlers: handlers,
      });
      try {
        for await (const event of stream as AsyncIterable<AgentSessionEvent>) {
          this.options.onEvent?.(event);
          if (event.type === "agent.session.created") {
            sessionId = event.session.id;
            if (signal.aborted) await cancel();
          }
          if (event.type === "agent.session.turn.output_text.done") {
            summary = summary === "" ? event.text : `${summary}\n${event.text}`;
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
      return { summary: cancelled && summary === "" ? "Ход отменён" : summary, calls };
    } finally {
      signal.removeEventListener("abort", onAbort);
      if (sessionId !== null) {
        await this.client.beta.agents.sessions.delete(sessionId);
      }
    }
  }
}
