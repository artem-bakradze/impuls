import { HeuristicPolicy, IdlePolicy } from "@impuls/agent";
import type { AgentRuntime, AgentToolbox, BreakdownAnswer, HypothesisDraft, TurnResult } from "@impuls/agent";
import { factKey, rubles } from "@impuls/core";
import type { InsightDraft } from "@impuls/core";
import type { AdTruth } from "@impuls/platforms";
import { describe, expect, it } from "vitest";
import { MAX_OPEN_HYPOTHESES, runAgentTurn } from "./agent-turn";
import { SimulationDriver } from "./simulation";

/** «бесплатно» never brings leads; one query carries a phone number; phones lead worse than computers. */
const junky: AdTruth = {
  impressionsPerDay: 800,
  ctr: 0.06,
  cr: 0.1,
  costPerClick: rubles(20),
  queries: [
    { text: "маникюр у метро", share: 0.5, crFactor: 1.6 },
    { text: "маникюр бесплатно", share: 0.3, crFactor: 0 },
    { text: "маникюр 89161234567", share: 0.2, crFactor: 1 },
  ],
  devices: { mobile: { share: 0.6, crFactor: 0.4 }, desktop: { share: 0.35, crFactor: 1.8 }, tablet: { share: 0.05 } },
};

const world = async () => {
  const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 3, agent: new IdlePolicy() });
  await sim.launchBusiness({
    id: "b1",
    monthlyBudgetRub: 30_000,
    launchedOn: "2026-10-01",
    csoSource: { kind: "user", goal: rubles(800) },
    directions: [{ name: "Маникюр — Поиск", weeklyLimitRub: 3_000, keywords: ["маникюр у метро"], ads: [{ title: "Маникюр у метро", truth: junky }] }],
  });
  await sim.runDays(14);
  return sim;
};

/** Runs the given script as the agent's turn. */
class ScriptPolicy implements AgentRuntime {
  readonly name = "policy:script";
  readonly instructionsVersion = "test";
  readonly decides = true;
  constructor(private readonly script: (tools: AgentToolbox) => Promise<void>) {}
  async runTurn(input: { tools: AgentToolbox }): Promise<TurnResult> {
    await this.script(input.tools);
    return { summary: "", calls: [], usage: null };
  }
}

const turn = (sim: SimulationDriver, script: (tools: AgentToolbox) => Promise<void>) =>
  runAgentTurn({ ...sim.ctx, agent: new ScriptPolicy(script) }, "b1", { kind: "daily_review" });

const rows = (answer: BreakdownAnswer) => (answer.status === "ok" ? answer.rows : []);
const rowOf = (answer: BreakdownAnswer, segment: string) => {
  const row = rows(answer).find((r) => r.segment === segment);
  if (!row) throw new Error(`no row ${segment}`);
  return row;
};
const key = (prefix: string, metric: string) => `${prefix}:${metric}:14d`;

describe("breakdowns in the agent's turn (add-agent-analyst-stage1)", () => {
  it("shows queries with the service's verdict, hides the one with a phone number, and caches the breakdown", async () => {
    const sim = await world();
    let calls = 0;
    const platformFor = (id: string) => {
      const platform = sim.ctx.platformFor(id);
      return Object.assign(Object.create(platform) as typeof platform, {
        getBreakdown: (...args: Parameters<typeof platform.getBreakdown>) => {
          calls++;
          return platform.getBreakdown(...args);
        },
      });
    };
    const answers: BreakdownAnswer[] = [];
    await runAgentTurn(
      {
        ...sim.ctx,
        platformFor,
        agent: new ScriptPolicy(async (tools) => {
          answers.push(await tools.breakdown("b1-d1", "query"), await tools.breakdown("b1-d1", "query"), await tools.breakdown("b1-d1", "device"));
        }),
      },
      "b1",
      { kind: "daily_review" },
    );
    const [queries, again, devices] = answers;
    expect(calls).toBe(2);
    expect(again).toBe(queries);
    expect(queries).toMatchObject({ status: "ok", dimension: "query", days: 14, hidden: 1 });
    expect(rows(queries!).map((r) => r.segment).sort()).toEqual(["маникюр бесплатно", "маникюр у метро"]);
    expect(JSON.stringify(queries)).not.toContain("89161234567");
    expect(rowOf(queries!, "маникюр бесплатно")).toMatchObject({ leads: 0, verdict: "дороже цели" });
    expect(rowOf(queries!, "маникюр у метро").verdict).toBe("в цели");
    expect(rows(devices!).map((r) => r.segment)).toEqual(["телефоны", "компьютеры", "планшеты"]);
    expect(rowOf(devices!, "планшеты").verdict).toBe("собираем данные");
  });

  it("accepts an insight on the facts of a requested segment and refuses one on a segment not requested", async () => {
    const sim = await world();
    const results: unknown[] = [];
    await turn(sim, async (tools) => {
      const queries = await tools.breakdown("b1-d1", "query");
      const free = rowOf(queries, "маникюр бесплатно");
      const draft: InsightDraft = {
        reasonCode: "JUNK_QUERY",
        observation: `По запросу «маникюр бесплатно» потратили ${free.spendRub} ₽ и не получили ни одного обращения.`,
        factKeys: [key(free.factKeyPrefix, "spend"), key(free.factKeyPrefix, "leads"), factKey.goal()],
        next: "Через неделю проверим, подешевело ли обращение.",
      };
      results.push(await tools.act({ type: "AddNegativeKeywords", directionId: "b1-d1", phrases: ["бесплатно"] }, draft));
      // The tablets' facts exist only after a device breakdown.
      results.push(
        await tools.observe({
          reasonCode: "TABLETS",
          observation: "С планшетов клиентов почти нет.",
          factKeys: [factKey.segment("b1-d1", "device", "tablet", "leads"), factKey.goal()],
          next: "Посмотрим через неделю.",
          decision: "Пока ничего не меняем.",
        }),
      );
    });
    expect(results[0]).toEqual({ status: "applied", message: "выполнено" });
    expect(results[1]).toMatchObject({ status: "rejected", code: "INSIGHT_INVALID" });
    expect((results[1] as { message: string }).message).toContain("таких данных у сервиса нет");

    const insight = (await sim.store.insights("b1")).find((i) => i.reasonCode === "JUNK_QUERY");
    expect(insight?.facts.map((f) => f.object)).toEqual(["реклама в поиске, запрос «маникюр бесплатно»", "реклама в поиске, запрос «маникюр бесплатно»", "цель"]);
    expect(insight?.decision).toMatchObject({ status: "applied", text: "Добавили минус-фразу «бесплатно»: реклама в поиске" });
    const change = (await sim.store.changes("b1")).find((c) => c.action.type === "AddNegativeKeywords");
    expect(change?.insightId).toBe(insight?.id);
  });
});

describe("analyst levers in the agent's turn (add-agent-analyst-stage1)", () => {
  it("clamps an adjustment, lets the insight cite its percents, and shows the guard's refusal", async () => {
    const sim = await world();
    const results: unknown[] = [];
    await turn(sim, async (tools) => {
      const devices = await tools.breakdown("b1-d1", "device");
      const phones = rowOf(devices, "телефоны");
      const computers = rowOf(devices, "компьютеры");
      const draft: InsightDraft = {
        reasonCode: "EXPENSIVE_PHONES",
        observation: "С телефонов обращение обходится дороже, чем с компьютеров, поэтому снижаем цену перехода с телефонов на 30%.",
        factKeys: [key(phones.factKeyPrefix, "cost_per_lead"), key(computers.factKeyPrefix, "cost_per_lead"), factKey.goal()],
        next: "Через неделю сравним цену обращения.",
      };
      results.push(await tools.act({ type: "SetDeviceAdjustment", directionId: "b1-d1", device: "mobile", percent: -30 }, draft));
      results.push(await tools.act({ type: "SetDeviceAdjustment", directionId: "b1-d1", device: "mobile", percent: -30 }, draft));
    });
    expect(results).toEqual([
      { status: "clamped", message: "урезано: не больше 25 пунктов за шаг" },
      { status: "rejected", code: "DEVICE_COOLDOWN", message: "корректировку этого устройства можно менять не чаще раза в 7 дней" },
    ]);
    const [applied, refused] = (await sim.store.insights("b1")).filter((i) => i.reasonCode === "EXPENSIVE_PHONES");
    expect(applied?.decision.text).toBe(
      "Цена перехода с телефонов: было 0% → стало −25% (реклама в поиске) — урезано: не больше 25 пунктов за шаг",
    );
    expect(refused?.decision.status).toBe("rejected");
    expect(refused?.decision.text).toContain("отклонено: корректировку этого устройства");
  });
});

describe("hypothesis journal (ad-agent spec «Журнал гипотез»)", () => {
  const open = (factKeys: string[], statement = "С телефонов клиенты обходятся дороже"): HypothesisDraft => ({
    statement,
    factKeys,
    check: "Сравним цену обращения с телефонов и компьютеров к 22 октября",
    checkOn: "2026-10-22",
    status: "checking",
  });

  it("opens a hypothesis on the turn's facts, reads it back and closes it with a result", async () => {
    const sim = await world();
    let id = "";
    await turn(sim, async (tools) => {
      const devices = await tools.breakdown("b1-d1", "device");
      const phones = rowOf(devices, "телефоны");
      const saved = await tools.saveHypothesis(open([key(phones.factKeyPrefix, "cost_per_lead"), factKey.goal()]));
      expect(saved).toMatchObject({ status: "applied", message: "гипотеза записана" });
      id = saved.status === "applied" ? saved.id : "";
      expect(await tools.hypotheses()).toEqual([expect.objectContaining({ id, status: "checking", checkOn: "2026-10-22", openedOn: "2026-10-15", closedOn: null })]);
    });
    const [hypothesis] = await sim.store.hypotheses("b1");
    expect(hypothesis?.facts.map((f) => f.object)).toEqual(["реклама в поиске, с телефонов", "цель"]);

    await sim.runDays(7);
    await turn(sim, async (tools) => {
      expect(await tools.saveHypothesis({ ...open([factKey.goal(), factKey.budget("budget_left")]), id, status: "confirmed" })).toMatchObject({ status: "rejected", code: "RESULT_REQUIRED" });
      const closed = await tools.saveHypothesis({
        ...open([factKey.direction("b1-d1", "cost_per_lead", "14d"), factKey.goal()]),
        id,
        checkOn: "2026-10-22",
        status: "confirmed",
        result: "Цена обращения рекламы осталась ниже цели.",
      });
      expect(closed).toEqual({ status: "applied", message: "гипотеза закрыта", id });
    });
    const [closed] = await sim.store.hypotheses("b1");
    expect(closed).toMatchObject({ status: "confirmed", result: "Цена обращения рекламы осталась ниже цели." });
    expect(closed?.closedAt).toBeInstanceOf(Date);
  });

  it("checks the numbers, refuses a passed day and the eleventh open hypothesis", async () => {
    const sim = await world();
    const facts = [factKey.goal(), factKey.budget("budget_left")];
    await turn(sim, async (tools) => {
      expect(await tools.saveHypothesis(open(facts, "Обращение с телефонов стоит 12 345 ₽"))).toMatchObject({ status: "rejected", code: "INSIGHT_INVALID" });
      expect(await tools.saveHypothesis({ ...open(facts), checkOn: "2026-10-01" })).toMatchObject({ status: "rejected", code: "CHECK_DAY_PASSED" });
      for (let i = 0; i < MAX_OPEN_HYPOTHESES; i++) {
        expect((await tools.saveHypothesis(open(facts))).status).toBe("applied");
      }
      expect(await tools.saveHypothesis(open(facts))).toEqual({ status: "rejected", code: "HYPOTHESIS_LIMIT", message: "сначала закройте одну из открытых гипотез" });
    });
  });
});

describe("HeuristicPolicy with the analyst levers (add-agent-analyst-stage1 decision 10)", () => {
  /** Phones bring leads several times dearer than computers; «бесплатно» brings none. */
  const phonesDear: AdTruth = {
    impressionsPerDay: 1_000,
    ctr: 0.06,
    cr: 0.1,
    costPerClick: rubles(20),
    queries: [
      { text: "маникюр у метро", share: 0.7, crFactor: 1.4 },
      { text: "маникюр бесплатно", share: 0.3, crFactor: 0 },
    ],
    devices: { mobile: { share: 0.6, crFactor: 0.15 }, desktop: { share: 0.35, crFactor: 1.8 }, tablet: { share: 0.05 } },
  };

  it("cuts the junk query, lowers the price per click from phones and writes a hypothesis on Monday", async () => {
    const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 5, agent: new HeuristicPolicy() });
    await sim.launchBusiness({
      id: "b1",
      monthlyBudgetRub: 40_000,
      launchedOn: "2026-10-01",
      csoSource: { kind: "user", goal: rubles(500) },
      directions: [{ name: "Маникюр — Поиск", weeklyLimitRub: 6_000, keywords: ["маникюр у метро"], ads: [{ title: "Маникюр у метро", truth: phonesDear }] }],
    });
    await sim.runDays(14);
    const agentChanges = (await sim.store.changes("b1")).filter((c) => c.actor === "agent" && c.status === "applied");
    expect(agentChanges.map((c) => c.action)).toContainEqual({ type: "AddNegativeKeywords", directionId: "b1-d1", phrases: ["бесплатно"] });
    expect(agentChanges.map((c) => c.action)).toContainEqual({ type: "SetDeviceAdjustment", directionId: "b1-d1", device: "mobile", percent: -25 });
    const hypotheses = await sim.store.hypotheses("b1");
    expect(hypotheses.length).toBeGreaterThan(0);
    expect((await sim.store.turns("b1")).filter((t) => t.trigger === "weekly_review" && t.summaryValid).map((t) => t.summary)).not.toHaveLength(0);
  });
});
