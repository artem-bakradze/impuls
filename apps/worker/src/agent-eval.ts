import { rubles } from "@impuls/core";
import type { Kopecks } from "@impuls/core";
import type { AgentRuntime, HypothesisResult, ToolResult } from "@impuls/agent";
import type { AdTruth } from "@impuls/platforms";
import { SimulationDriver } from "./simulation";
import type { SimulatedDirection } from "./simulation";

/**
 * Agent eval (testing-harness spec): scenarios of different niches, budgets and goals, 30 simulated days each, run
 * twice — with the agent and with the deterministic rules only. The agent stays off for businesses unless it brings
 * leads cheaper than the rules, and clearly cheaper where only breakdowns can help.
 */
export interface EvalScenario {
  name: string;
  monthlyBudgetRub: number;
  goalRub: number;
  directions: SimulatedDirection[];
  /** Only the analyst levers can win here: junk queries or an expensive device (testing-harness spec). */
  analyst?: boolean;
}

const truth = (costPerLeadRub: number, impressionsPerDay = 1_500): AdTruth => ({ impressionsPerDay, ctr: 0.05, cr: 20 / costPerLeadRub, costPerClick: rubles(20) });

/**
 * The analyst scenarios bring a few hundred leads a month: on a few dozen the noise of the market (±15%) would hide
 * the 10% the release rule asks for.
 */
const ANALYST_IMPRESSIONS = 6_000;

/** A third of the traffic comes from queries that never bring a client. */
const JUNK_FLOWERS: NonNullable<AdTruth["queries"]> = [
  { text: "доставка цветов", share: 0.4, crFactor: 1.5 },
  { text: "букет с доставкой", share: 0.25, crFactor: 1.5 },
  { text: "доставка цветов вакансии курьер", share: 0.2, crFactor: 0 },
  { text: "букет с доставкой бесплатно", share: 0.15, crFactor: 0 },
];

const JUNK_CARS: NonNullable<AdTruth["queries"]> = [
  { text: "ремонт автомобиля", share: 0.45, crFactor: 1.5 },
  { text: "автосервис рядом", share: 0.25, crFactor: 1.5 },
  { text: "ремонт автомобиля своими руками", share: 0.3, crFactor: 0 },
];

/** Phones bring most of the clicks and few clients. */
const DEAR_PHONES: NonNullable<AdTruth["devices"]> = { mobile: { share: 0.65, crFactor: 0.2 }, desktop: { share: 0.3, crFactor: 2 }, tablet: { share: 0.05 } };

export const EVAL_SCENARIOS: readonly EvalScenario[] = [
  {
    name: "Маникюрный салон: одно объявление без обращений",
    monthlyBudgetRub: 15_000,
    goalRub: 800,
    directions: [{ name: "Маникюр — Поиск", weeklyLimitRub: 2_500, ads: [{ title: "Маникюр у метро", truth: truth(500) }, { title: "Маникюр без записи", truth: { ...truth(500), cr: 0 } }] }],
  },
  {
    name: "Йога-студия: дешёвое направление упирается в лимит",
    monthlyBudgetRub: 30_000,
    goalRub: 900,
    directions: [
      { name: "Йога — Поиск", weeklyLimitRub: 1_500, ads: [{ title: "Йога для начинающих", truth: truth(400) }] },
      { name: "Растяжка — Поиск", weeklyLimitRub: 3_000, ads: [{ title: "Растяжка утром", truth: truth(1_100) }] },
    ],
  },
  {
    name: "Барбершоп: пограничное объявление",
    monthlyBudgetRub: 20_000,
    goalRub: 700,
    directions: [{ name: "Стрижка — Поиск", weeklyLimitRub: 4_000, ads: [{ title: "Мужская стрижка", truth: truth(850, 2_500) }] }],
  },
  {
    name: "Массаж: цель недостижима",
    monthlyBudgetRub: 10_000,
    goalRub: 300,
    directions: [{ name: "Массаж — Поиск", weeklyLimitRub: 2_000, ads: [{ title: "Массаж спины", truth: truth(650) }] }],
  },
  {
    name: "Груминг: маленький бюджет",
    monthlyBudgetRub: 5_000,
    goalRub: 1_000,
    directions: [{ name: "Груминг — Поиск", weeklyLimitRub: 900, ads: [{ title: "Стрижка собак", truth: truth(700) }] }],
  },
  {
    name: "Доставка цветов: мусорные запросы",
    monthlyBudgetRub: 90_000,
    goalRub: 900,
    analyst: true,
    directions: [
      {
        name: "Цветы — Поиск",
        weeklyLimitRub: 20_000,
        keywords: ["доставка цветов", "букет с доставкой"],
        ads: [{ title: "Букеты с доставкой за час", truth: { ...truth(500, ANALYST_IMPRESSIONS), queries: JUNK_FLOWERS } }],
      },
    ],
  },
  {
    name: "Стоматология: дорогие обращения с телефонов",
    monthlyBudgetRub: 90_000,
    goalRub: 700,
    analyst: true,
    directions: [{ name: "Стоматология — Поиск", weeklyLimitRub: 20_000, ads: [{ title: "Лечение зубов без боли", truth: { ...truth(400, ANALYST_IMPRESSIONS), devices: DEAR_PHONES } }] }],
  },
  {
    name: "Автосервис: мусорные запросы и дорогие телефоны",
    monthlyBudgetRub: 90_000,
    goalRub: 900,
    analyst: true,
    directions: [
      {
        name: "Автосервис — Поиск",
        weeklyLimitRub: 20_000,
        keywords: ["ремонт автомобиля", "автосервис рядом"],
        ads: [{ title: "Ремонт авто за день", truth: { ...truth(450, ANALYST_IMPRESSIONS), queries: JUNK_CARS, devices: DEAR_PHONES } }],
      },
    ],
  },
];

export interface EvalRun {
  spend: Kopecks;
  leads: number;
  costPerLead: Kopecks | null;
  /** Agent actions refused by the guards (zero without the agent). */
  rejectedActions: number;
  /** Share of agent actions and observations whose insight passed the checks at once; null when the agent did nothing. */
  firstTryInsights: number | null;
  /** Share of the turns whose «Разбор дня» passed the checks; null without turns. */
  validSummaries: number | null;
  /** Share of the hypotheses whose texts passed the checks at once; null when the agent wrote none. */
  firstTryHypotheses: number | null;
  /** Completed turns and their token usage (from the API or the service's estimate). */
  turns: number;
  inputTokens: number;
  outputTokens: number;
  /** Of them, the weekly reviews: they run on the strategy model when one is configured. */
  weeklyInputTokens: number;
  weeklyOutputTokens: number;
  /** What the agent did, day by day, for reading the run (`pnpm eval:agent --report <file>`). */
  journal: { day: number; summary: string | null; summaryValid: boolean; calls: { command: string; observation: string; status: string; message: string }[] }[];
}

export interface EvalResult {
  scenario: string;
  analyst: boolean;
  withAgent: EvalRun;
  withoutAgent: EvalRun;
}

const EVAL_DAYS = 30;

const runOnce = async (scenario: EvalScenario, seed: number, agent: AgentRuntime, agentEnabled: boolean, strategist: AgentRuntime | undefined): Promise<EvalRun> => {
  const sim = new SimulationDriver({ start: new Date("2026-10-01T00:00:00Z"), seed, agent, agentEnabled });
  if (strategist !== undefined) {
    // The weekly review on the strategy model, as in the deployment (ad-agent spec); prices only matter for the limits.
    sim.ctx.strategist = { runtime: strategist, costs: { inputKopecksPerMTok: 0, outputKopecksPerMTok: 0, monthlyLimitKopecks: Number.MAX_SAFE_INTEGER, simulationRunLimitKopecks: Number.MAX_SAFE_INTEGER } };
  }
  await sim.launchBusiness({
    id: "eval",
    monthlyBudgetRub: scenario.monthlyBudgetRub,
    launchedOn: "2026-10-01",
    csoSource: { kind: "user", goal: rubles(scenario.goalRub) },
    directions: scenario.directions,
  });
  await sim.runDays(EVAL_DAYS);
  const ids = (await sim.store.directions("eval")).map((d) => d.platformCampaignId);
  const rows = await sim.platform.getStats(ids, "2026-10-01", "2026-10-30");
  const spend = rows.reduce((sum, r) => sum + r.spend, 0);
  const leads = rows.reduce((sum, r) => sum + r.leads, 0);
  const turns = (await sim.store.turns("eval")).filter((t) => t.status === "completed");
  const results = turns.flatMap((t) => (t.calls as { result: ToolResult }[]).map((c) => c.result));
  const start = Date.parse("2026-10-01T00:00:00Z");
  const journal = turns.map((t) => ({
    day: Math.floor((t.startedAt.getTime() - start) / 86_400_000) + 1,
    summary: t.summary,
    summaryValid: t.summaryValid,
    calls: (t.calls as { command: { type: string } | null; insight: { observation: string; decision?: string }; result: ToolResult }[]).map((c) => ({
      command: c.command?.type ?? "report_insight",
      observation: c.insight.observation,
      status: c.result.status,
      message: c.result.status === "rejected" ? `${c.result.code}: ${c.result.message}` : c.result.message,
    })),
  }));
  const insightRejections = results.filter((r) => r.status === "rejected" && r.code === "INSIGHT_INVALID").length;
  const hypotheses = turns.flatMap((t) => ((t.context as { hypotheses?: { result: HypothesisResult }[] }).hypotheses ?? []).map((h) => h.result));
  const weekly = turns.filter((t) => t.trigger === "weekly_review");
  return {
    spend,
    leads,
    costPerLead: leads === 0 ? null : Math.round(spend / leads),
    rejectedActions: results.filter((r) => r.status === "rejected").length,
    firstTryInsights: results.length === 0 ? null : (results.length - insightRejections) / results.length,
    validSummaries: turns.length === 0 ? null : turns.filter((t) => t.summaryValid).length / turns.length,
    firstTryHypotheses:
      hypotheses.length === 0 ? null : hypotheses.filter((r) => !(r.status === "rejected" && r.code === "INSIGHT_INVALID")).length / hypotheses.length,
    turns: turns.length,
    inputTokens: turns.reduce((sum, t) => sum + (t.inputTokens ?? 0), 0),
    outputTokens: turns.reduce((sum, t) => sum + (t.outputTokens ?? 0), 0),
    weeklyInputTokens: weekly.reduce((sum, t) => sum + (t.inputTokens ?? 0), 0),
    weeklyOutputTokens: weekly.reduce((sum, t) => sum + (t.outputTokens ?? 0), 0),
    journal,
  };
};

/**
 * Runs every scenario with the agent and without it on the same seed, so the market is the same. Scenarios are
 * independent simulated markets and run at the same time: a model turn takes up to a minute. `strategist` runs the
 * weekly reviews when the deployment has a strategy model; without it they run on `agent`.
 */
export const runAgentEval = async (agent: AgentRuntime, scenarios: readonly EvalScenario[] = EVAL_SCENARIOS, seed = 11, strategist?: AgentRuntime): Promise<EvalResult[]> =>
  Promise.all(
    scenarios.map(async (scenario) => ({
      scenario: scenario.name,
      analyst: scenario.analyst === true,
      withAgent: await runOnce(scenario, seed, agent, true, strategist),
      withoutAgent: await runOnce(scenario, seed, agent, false, strategist),
    })),
  );

/** Mean cost per lead over scenarios that have leads in both runs. */
const meanCostPerLead = (results: readonly EvalResult[], pick: (r: EvalResult) => EvalRun): number | null => {
  const values = results.filter((r) => r.withAgent.costPerLead !== null && r.withoutAgent.costPerLead !== null).map((r) => pick(r).costPerLead ?? 0);
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
};

/** On the analyst scenarios the agent must bring leads at least 10% cheaper than the rules (testing-harness spec). */
export const ANALYST_SHARE = 0.9;

/** Insights and day reviews the owner sees must pass the checks almost always (add-agent-insights task 4.4). */
export const MIN_VALID_SHARE = 0.9;

const lowestShare = (results: readonly EvalResult[], pick: (run: EvalRun) => number | null): number | null => {
  const values = results.map((r) => pick(r.withAgent)).filter((v): v is number => v !== null);
  return values.length === 0 ? null : Math.min(...values);
};

/**
 * The release rule (testing-harness spec «Сценарии аналитика в eval»): on the usual scenarios the agent is not more
 * expensive than the rules alone, on the analyst ones at most 90% of them, and the insights, hypotheses and day
 * reviews it writes for the owner pass the checks.
 */
export const evalVerdict = (
  results: readonly EvalResult[],
): {
  withAgent: number | null;
  withoutAgent: number | null;
  analystWithAgent: number | null;
  analystWithoutAgent: number | null;
  firstTryInsights: number | null;
  validSummaries: number | null;
  firstTryHypotheses: number | null;
  enableAgent: boolean;
} => {
  const usual = results.filter((r) => !r.analyst);
  const analyst = results.filter((r) => r.analyst);
  const withAgent = meanCostPerLead(usual, (r) => r.withAgent);
  const withoutAgent = meanCostPerLead(usual, (r) => r.withoutAgent);
  const analystWithAgent = meanCostPerLead(analyst, (r) => r.withAgent);
  const analystWithoutAgent = meanCostPerLead(analyst, (r) => r.withoutAgent);
  const firstTryInsights = lowestShare(results, (run) => run.firstTryInsights);
  const validSummaries = lowestShare(results, (run) => run.validSummaries);
  const firstTryHypotheses = lowestShare(results, (run) => run.firstTryHypotheses);
  const cheapEnough = usual.length === 0 || (withAgent !== null && withoutAgent !== null && withAgent <= withoutAgent);
  const analystWins = analyst.length === 0 || (analystWithAgent !== null && analystWithoutAgent !== null && analystWithAgent <= analystWithoutAgent * ANALYST_SHARE);
  const plain = [firstTryInsights, validSummaries, firstTryHypotheses].every((share) => (share ?? 1) >= MIN_VALID_SHARE);
  return {
    withAgent,
    withoutAgent,
    analystWithAgent,
    analystWithoutAgent,
    firstTryInsights,
    validSummaries,
    firstTryHypotheses,
    enableAgent: cheapEnough && analystWins && plain,
  };
};
