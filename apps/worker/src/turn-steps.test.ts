import { IdlePolicy } from "@impuls/agent";
import type { AgentRuntime, AgentToolbox, HypothesisResult, TurnResult, TurnSnapshot, TurnTrigger } from "@impuls/agent";
import { factKey, rubles } from "@impuls/core";
import type { InsightDraft } from "@impuls/core";
import { describe, expect, it } from "vitest";
import { MAX_NEW_HYPOTHESES_PER_PERIOD, runAgentTurn, turnSteps } from "./agent-turn";
import type { TurnStep } from "./agent-turn";
import { SimulationDriver } from "./simulation";
import type { Store } from "./store";

const good = { impressionsPerDay: 800, ctr: 0.06, cr: 0.1, costPerClick: rubles(20) };
const bad = { impressionsPerDay: 800, ctr: 0.06, cr: 0, costPerClick: rubles(30) };
/** An insight on facts every snapshot has; the texts carry no numbers. */
const insight: InsightDraft = { reasonCode: "AGENT", observation: "Реклама в поиске приводит клиентов дешевле цели.", factKeys: [factKey.goal(), factKey.budget("budget_left")], next: "Проверю через неделю." };

/** A week of the market with no deciding agent; the turn under test gets its own policy. */
const world = async () => {
  const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed: 8, agent: new IdlePolicy() });
  await sim.launchBusiness({
    id: "b1",
    monthlyBudgetRub: 30_000,
    launchedOn: "2026-10-01",
    csoSource: { kind: "user", goal: rubles(800) },
    directions: [{ name: "Маникюр — Поиск", weeklyLimitRub: 2_000, ads: [{ title: "Маникюр у метро", truth: good }, { title: "Маникюр без записи", truth: bad }] }],
  });
  await sim.runDays(8);
  return sim;
};

const stepsOf = (context: unknown): TurnStep[] => turnSteps(context);

/** Reads its memory, a breakdown, writes a hypothesis, makes one change, has one refused, notes one observation. */
class SteppingPolicy implements AgentRuntime {
  readonly name = "policy:stepping";
  readonly instructionsVersion = "test";
  readonly decides = true;
  /** The running turn's steps as the screen would read them in the middle of the turn. */
  midway: TurnStep[] = [];
  constructor(private readonly store: Store) {}
  async runTurn(input: { snapshot: TurnSnapshot; tools: AgentToolbox }): Promise<TurnResult> {
    await input.tools.recentInsights();
    await input.tools.hypotheses();
    await input.tools.breakdown("b1-d1", "device");
    await input.tools.saveHypothesis({ statement: "С телефонов обращения дороже, чем с компьютеров.", factKeys: [factKey.goal(), factKey.budget("budget_left")], check: "Сравню устройства.", checkOn: input.snapshot.today, status: "checking" });
    this.midway = (await this.store.runningTurn("b1"))?.steps ?? [];
    await input.tools.act({ type: "PauseAd", adId: "b1-d1-a2" }, { ...insight, observation: "Отключил объявление без обращений." });
    // A number that is not in the facts: the service refuses the insight, and nothing is done.
    await input.tools.act({ type: "PauseAd", adId: "b1-d1-a1" }, { ...insight, observation: "Отключил объявление: 12345 ₽ без обращений." });
    await input.tools.observe({ ...insight, decision: "Пока ничего не меняю." });
    return { summary: "Посмотрел цифры.", calls: [], usage: null };
  }
}

/** Tries to write three new hypotheses in one turn. */
class ManyHypothesesPolicy implements AgentRuntime {
  readonly name = "policy:many-hypotheses";
  readonly instructionsVersion = "test";
  readonly decides = true;
  results: HypothesisResult[] = [];
  async runTurn(input: { snapshot: TurnSnapshot; tools: AgentToolbox }): Promise<TurnResult> {
    for (const statement of ["Поиску мало дней.", "Объявления не про то, что ищут.", "Цена перехода высока."]) {
      this.results.push(await input.tools.saveHypothesis({ statement, factKeys: [factKey.goal(), factKey.budget("budget_left")], check: "Посмотрю через неделю.", checkOn: input.snapshot.today, status: "checking" }));
    }
    return { summary: "Записал гипотезы.", calls: [], usage: null };
  }
}

describe("the turn's steps as they are done (simulation-mode «Ход разбора на глазах владельца»)", () => {
  it("records only what is done and passed its checks, in order, and saves them while the turn runs", async () => {
    const sim = await world();
    const policy = new SteppingPolicy(sim.store);
    await runAgentTurn({ ...sim.ctx, agent: policy }, "b1", { kind: "daily_review" });
    const turn = (await sim.store.turns("b1")).at(-1);
    expect({ status: turn?.status, summary: turn?.summary }).toEqual({ status: "completed", summary: "Посмотрел цифры." });
    const steps = stepsOf(turn?.context);
    expect(steps.map((s) => s.kind)).toEqual(["numbers", "memory", "breakdown", "hypothesis_saved", "change", "observation"]);
    expect(steps[3]).toEqual({ kind: "hypothesis_saved", statement: "С телефонов обращения дороже, чем с компьютеров." });
    // The applied change by its history entry; the refused one is not a step.
    const change = (await sim.store.changes("b1")).find((c) => c.actor === "agent" && c.status === "applied" && c.action.type === "PauseAd");
    expect(steps[4]).toEqual({ kind: "change", changeId: change?.id });
    expect(steps.filter((s) => s.kind === "change")).toHaveLength(1);
    // Midway the screen already had the first steps.
    expect(policy.midway.map((s) => s.kind)).toEqual(["numbers", "memory", "breakdown", "hypothesis_saved"]);
  });

  it("lets a period review write two new hypotheses, not three; a daily turn is not limited this way", async () => {
    const period = new ManyHypothesesPolicy();
    const sim = await world();
    const trigger: TurnTrigger = { kind: "period_review", from: "2026-10-01", to: "2026-10-08" };
    await runAgentTurn({ ...sim.ctx, agent: period }, "b1", trigger);
    expect(period.results.map((r) => r.status)).toEqual(["applied", "applied", "rejected"]);
    expect(period.results[MAX_NEW_HYPOTHESES_PER_PERIOD]).toMatchObject({ code: "PERIOD_HYPOTHESIS_LIMIT", message: "за этот разбор уже записаны две гипотезы — выбери главную" });
    const daily = new ManyHypothesesPolicy();
    await runAgentTurn({ ...sim.ctx, agent: daily }, "b1", { kind: "daily_review" });
    expect(daily.results.map((r) => r.status)).toEqual(["applied", "applied", "applied"]);
  });
});

/** Keeps the snapshot it got. */
class SnapshotPolicy implements AgentRuntime {
  readonly name = "policy:snapshot";
  readonly instructionsVersion = "test";
  readonly decides = true;
  snapshot: TurnSnapshot | null = null;
  runTurn(input: { snapshot: TurnSnapshot }): Promise<TurnResult> {
    this.snapshot = input.snapshot;
    return Promise.resolve({ summary: "Посмотрел цифры.", calls: [], usage: null });
  }
}

describe("the period's totals in the snapshot (ad-agent «Рассказ в разборе периода»)", () => {
  it("are in a period review's facts only, over the period's days", async () => {
    const sim = await world();
    const period = new SnapshotPolicy();
    await runAgentTurn({ ...sim.ctx, agent: period }, "b1", { kind: "period_review", from: "2026-10-01", to: "2026-10-07" });
    const totals = (period.snapshot?.facts ?? []).filter((f) => f.period === "period");
    const spend = (await sim.store.stats("b1", "2026-10-01", "2026-10-07")).reduce((s, r) => s + r.spend, 0);
    expect(totals.find((f) => f.key === factKey.total("spend"))?.value).toBe(Math.round(spend / 100));
    expect(totals.some((f) => f.key === factKey.channel("search", "spend", "period"))).toBe(true);
    const daily = new SnapshotPolicy();
    await runAgentTurn({ ...sim.ctx, agent: daily }, "b1", { kind: "daily_review" });
    expect((daily.snapshot?.facts ?? []).some((f) => f.period === "period")).toBe(false);
  });
});
