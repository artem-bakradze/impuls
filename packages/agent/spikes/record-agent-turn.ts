/**
 * Records one real agent turn at the HTTP level for the recorded-event contract test (task 10.1).
 * Paid (cents); run on request only. Headers (with the API key) are never recorded.
 *
 *   set -a; . ./.env.local; set +a
 *   OPENAI_AGENT_MODEL=gpt-6.1-sol pnpm --filter @impuls/agent exec tsx spikes/record-agent-turn.ts
 */
import { writeFileSync } from "node:fs";
import { OpenAiAgentRuntime } from "../src/openai-runtime";
import type { AgentToolbox, TurnSnapshot } from "../src/runtime";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_AGENT_MODEL;
if (!apiKey || !model) {
  throw new Error(`${!apiKey ? "OPENAI_API_KEY" : "OPENAI_AGENT_MODEL"} is required to record an agent turn`);
}

export interface RecordedExchange {
  method: string;
  path: string;
  requestBody: unknown;
  status: number;
  contentType: string;
  responseBody: string;
}

const exchanges: RecordedExchange[] = [];

const recordingFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const response = await fetch(input, init);
  const exchange: RecordedExchange = {
    method: init?.method ?? "GET",
    path: url.pathname,
    requestBody: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    responseBody: "",
  };
  exchanges.push(exchange);
  if (!response.body) {
    return response;
  }
  // Tee the body: the SDK reads the live SSE stream while a copy is collected for the fixture.
  const [forSdk, forRecord] = response.body.tee();
  void new Response(forRecord).text().then((text) => {
    exchange.responseBody = text;
  });
  return new Response(forSdk, { status: response.status, headers: response.headers });
};

export const snapshot: TurnSnapshot = {
  today: "2026-10-29",
  business: { category: "Маникюрный салон", services: [{ name: "Маникюр с покрытием", priceRub: 1_800 }], area: "Москва, м. Профсоюзная, радиус 3 км", hours: "Пн–Вс 10:00–22:00", advantages: ["Работаем без выходных"] },
  goal: { costPerLeadRub: 800, mode: "user" },
  budget: { monthRub: 30_000, spentRub: 12_400 },
  strategyCatalog: [
    { id: "WB_MAXIMUM_CLICKS", title: "Максимум кликов с недельным лимитом" },
    { id: "AVERAGE_CPA", title: "Оптимизация обращений по средней цене" },
  ],
  directions: [{ id: "d1", name: "Маникюр — Поиск", status: "active", weeklyLimitRub: 2_000, strategyId: "WB_MAXIMUM_CLICKS", class: "effective", spend14Rub: 5_700, leads14: 6, spend7Rub: 1_950 }],
  ads: [
    { id: "a1", directionId: "d1", status: "active", title: "Маникюр у метро", text: "Маникюр с покрытием 1 800 ₽", class: "effective", spend14Rub: 3_100, leads14: 6 },
    { id: "a2", directionId: "d1", status: "active", title: "Маникюр без записи", text: "Приходите без записи", class: "ineffective", spend14Rub: 2_600, leads14: 0 },
  ],
  userDecisions: [],
  notes: [],
};

const tools: AgentToolbox = {
  act: (command) => Promise.resolve(command.type === "PauseAd" ? { status: "applied", message: "выполнено" } : { status: "rejected", code: "NOT_IN_RECORDING", message: "в записи разрешена только пауза объявления" }),
  saveNote: () => Promise.resolve(),
};

const runtime = new OpenAiAgentRuntime({ apiKey, model, fetch: recordingFetch });
const result = await runtime.runTurn({ trigger: { kind: "daily_review" }, snapshot, tools, signal: new AbortController().signal });
await new Promise((resolve) => setTimeout(resolve, 500));
const target = new URL("../fixtures/agent-turn-daily-review.json", import.meta.url);
writeFileSync(target, `${JSON.stringify({ model, recordedAt: new Date().toISOString(), result, exchanges }, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
console.log(`${exchanges.length} exchanges recorded to ${target.pathname}`);
