import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OpenAiAgentRuntime } from "./openai-runtime";
import type { AgentToolbox, ToolResult, TurnSnapshot } from "./runtime";

/** A real turn recorded at the HTTP level by `spikes/record-agent-turn.ts` (gpt-6.1-sol, 2026-10-29). */
interface Exchange {
  method: string;
  path: string;
  requestBody: { events?: { type: string; call_id?: string; turn_id?: string; output?: string }[] } | null;
  status: number;
  contentType: string;
  responseBody: string;
}
const recorded = JSON.parse(readFileSync(new URL("../fixtures/agent-turn-daily-review.json", import.meta.url), "utf8")) as { exchanges: Exchange[] };

interface Sent {
  method: string;
  path: string;
  body: Exchange["requestBody"];
}

/** Serves responses in order; every request the runtime makes is kept for assertions. */
const replay = (responses: { status: number; contentType: string; body: string }[]) => {
  const sent: Sent[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    sent.push({ method: init?.method ?? "GET", path: url.pathname, body: typeof init?.body === "string" ? (JSON.parse(init.body) as Exchange["requestBody"]) : null });
    const next = responses.shift();
    if (!next) {
      return Promise.reject(new Error(`Unexpected request ${init?.method ?? "GET"} ${url.pathname}`));
    }
    return Promise.resolve(new Response(next.status === 202 ? null : next.body, { status: next.status, headers: next.contentType ? { "content-type": next.contentType } : {} }));
  };
  return { fetchImpl, sent };
};

const toolResults = (exchanges: readonly { body: Exchange["requestBody"] }[]) =>
  exchanges.flatMap((e) => e.body?.events ?? []).filter((e) => e.type === "agent.session.input.tool_result");

const recordedSnapshot = (): TurnSnapshot => {
  const answer = toolResults(recorded.exchanges.map((e) => ({ body: e.requestBody })))[0];
  return JSON.parse(answer?.output ?? "{}") as TurnSnapshot;
};

const toolbox = (results: ToolResult[] = []) => {
  const acted: string[] = [];
  const tools: AgentToolbox = {
    act: (command) => {
      acted.push(command.type);
      return Promise.resolve(results.shift() ?? { status: "applied", message: "выполнено" });
    },
    saveNote: () => Promise.resolve(),
  };
  return { tools, acted };
};

const sse = (events: object[]): string => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");

const session = { id: "sess_1", object: "agent.session", metadata: {}, status: "in_progress", required_actions: [] };

describe("OpenAiAgentRuntime on a recorded Agents API turn", () => {
  it("answers the same tool calls, executes the pause through the toolbox and deletes the session", async () => {
    const { fetchImpl, sent } = replay(recorded.exchanges.map((e) => ({ status: e.status, contentType: e.contentType, body: e.responseBody })));
    const { tools, acted } = toolbox();
    const runtime = new OpenAiAgentRuntime({ apiKey: "test-key", model: "gpt-6.1-sol", fetch: fetchImpl });
    const result = await runtime.runTurn({ trigger: { kind: "daily_review" }, snapshot: recordedSnapshot(), tools, signal: new AbortController().signal });

    expect(acted).toEqual(["PauseAd"]);
    expect(result.calls).toEqual([
      expect.objectContaining({ command: { type: "PauseAd", adId: "a2" }, justification: expect.objectContaining({ reasonCode: "PAUSE_INEFFECTIVE" }) as unknown }),
    ]);
    expect(result.summary).toContain("Маникюр без записи");
    // Same call ids and turn as in the recording, answered in the same order.
    const answered = toolResults(sent).map((e) => [e.call_id, e.turn_id]);
    expect(answered).toEqual(toolResults(recorded.exchanges.map((e) => ({ body: e.requestBody }))).map((e) => [e.call_id, e.turn_id]));
    expect(sent.at(-1)).toMatchObject({ method: "DELETE", path: expect.stringMatching(/^\/v1\/agents\/sessions\/sess_/) as unknown });
    // The session is created with environment none, our tools and the versioned instructions.
    const create = sent[0]?.body as unknown as { environment: unknown; agent: { model: string; tools: { name: string }[] }; metadata: Record<string, string> };
    expect(create.environment).toEqual({ type: "none" });
    expect(create.agent.model).toBe("gpt-6.1-sol");
    expect(create.agent.tools.map((t) => t.name)).toEqual(expect.arrayContaining(["get_snapshot", "pause_ad", "set_spend_limit", "save_note"]) as unknown);
    expect(create.agent.tools.map((t) => t.name)).not.toContain("get_history");
    expect(create.metadata).toEqual({ purpose: "impuls-turn", instructions: runtime.instructionsVersion });
  });

  it("returns a guard refusal to the model as a normal result", async () => {
    const { fetchImpl, sent } = replay(recorded.exchanges.map((e) => ({ status: e.status, contentType: e.contentType, body: e.responseBody })));
    const { tools } = toolbox([{ status: "rejected", code: "STATE_CHANGED", message: "состояние объекта изменилось" }]);
    const result = await new OpenAiAgentRuntime({ apiKey: "k", model: "gpt-6.1-sol", fetch: fetchImpl }).runTurn({ trigger: { kind: "daily_review" }, snapshot: recordedSnapshot(), tools, signal: new AbortController().signal });
    expect(result.calls[0]?.result).toEqual({ status: "rejected", code: "STATE_CHANGED", message: "состояние объекта изменилось" });
    expect(toolResults(sent).some((e) => e.output?.includes("состояние объекта изменилось"))).toBe(true);
  });
});

describe("OpenAiAgentRuntime edge cases", () => {
  const call = { id: "fc_1", type: "function_call", call_id: "call_1", name: "get_snapshot", arguments: "{}", status: "in_progress", turn_id: "turn_1" };

  it("treats 409 after its own cancel as the end of a cancelled turn and still deletes the session", async () => {
    const controller = new AbortController();
    const stream = sse([
      { type: "agent.session.created", event_id: "e1", session },
      { type: "agent.session.turn.created", event_id: "e2", turn: { id: "turn_1" } },
      { type: "agent.session.turn.item.added", event_id: "e3", item: call, output_index: 0, turn_id: "turn_1" },
    ]);
    const conflict = JSON.stringify({ error: { type: "conflict_error", code: "conflict_error", message: "the server request is no longer pending", param: null } });
    const { fetchImpl, sent } = replay([
      { status: 201, contentType: "text/event-stream", body: stream },
      { status: 202, contentType: "", body: "" },
      { status: 409, contentType: "application/json", body: conflict },
      { status: 200, contentType: "application/json", body: JSON.stringify({ id: "sess_1", object: "agent.session.deleted", deleted: true }) },
    ]);
    const tools: AgentToolbox = { act: () => Promise.reject(new Error("no actions expected")), saveNote: () => Promise.resolve() };
    const runtime = new OpenAiAgentRuntime({ apiKey: "k", model: "m", fetch: fetchImpl, onEvent: (event) => event.type === "agent.session.created" && controller.abort("settings_changed") });
    const result = await runtime.runTurn({ trigger: { kind: "settings_changed" }, snapshot: recordedSnapshot(), tools, signal: controller.signal });
    expect(result).toEqual({ summary: "Ход отменён", calls: [] });
    expect(sent.map((s) => s.body?.events?.[0]?.type ?? s.method)).toEqual(["POST", "agent.session.input.cancel", "agent.session.input.tool_result", "DELETE"]);
  });

  it("fails the turn on turn.failed and still deletes the session", async () => {
    const { fetchImpl, sent } = replay([
      { status: 201, contentType: "text/event-stream", body: sse([{ type: "agent.session.created", event_id: "e1", session }, { type: "agent.session.turn.failed", event_id: "e2", turn: { id: "turn_1" }, error: { message: "model overloaded" } }]) },
      { status: 200, contentType: "application/json", body: JSON.stringify({ id: "sess_1", object: "agent.session.deleted", deleted: true }) },
    ]);
    const { tools } = toolbox();
    await expect(
      new OpenAiAgentRuntime({ apiKey: "k", model: "m", fetch: fetchImpl }).runTurn({ trigger: { kind: "daily_review" }, snapshot: recordedSnapshot(), tools, signal: new AbortController().signal }),
    ).rejects.toThrow(/model overloaded|turn failed/);
    expect(sent.at(-1)?.method).toBe("DELETE");
  });

  it("refuses to start without a key or a model", () => {
    expect(() => new OpenAiAgentRuntime({ apiKey: "", model: "gpt-6.1-sol" })).toThrow(/required/);
  });
});
