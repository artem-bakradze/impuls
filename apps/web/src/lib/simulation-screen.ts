import { addDays, monthBudget, monthKey, toLocalDate } from "@impuls/core";
import type { Kopecks, LocalDate } from "@impuls/core";
import type { AdRecord, ChangeEntry, DirectionRecord, InsightRecord, SimulationRecord } from "@impuls/worker";
import { isAdDecision } from "@impuls/worker/change-kinds";
import { isScenarioId, SCENARIOS } from "@impuls/worker/scenarios";
import type { ScenarioShowKey } from "@impuls/worker/scenarios";
import { formatRub } from "./format";
import type { InsightFeedModel, TruthLine } from "./insights-model";

export type CheckKey = ScenarioShowKey | "rollback" | "budget";

export interface CheckItem {
  key: CheckKey;
  title: string;
  done: boolean;
  entryId: string | null;
  hint: string | null;
}

export interface RunTotals {
  spend: Kopecks;
  leads: number;
  costPerLead: Kopecks | null;
}

/** «С сервисом / без сервиса» by day (simulation-mode spec «Контрольный прогон»). */
export interface Comparison {
  /** Leads by the end of each day so far, from day 1. */
  service: number[];
  baseline: number[];
  serviceNow: RunTotals;
  baselineNow: RunTotals;
}

export interface RunResult {
  days: number;
  service: RunTotals;
  baseline: RunTotals;
}

/** «Как сервис принимает решения» (simulation-mode spec): the comparison, the result, the checklist; the feed comes with it. */
export interface DecisionScreenModel {
  day: number;
  totalDays: number;
  scenarioTitle: string;
  comparison: Comparison | null;
  /** Days with a decision of the service about the ads, as ticks under the comparison. */
  decisionDays: number[];
  checklist: CheckItem[];
  /** After the scenario's last day only. */
  result: RunResult | null;
}

/** The screen with its insight feed, where every insight about an ad or advertising has «На самом деле». */
export type DecisionScreen = DecisionScreenModel & { feed: InsightFeedModel };

export interface DecisionScreenInput {
  simulation: SimulationRecord;
  timeZone: string;
  monthlyBudgetRub: number;
  directions: DirectionRecord[];
  changes: ChangeEntry[];
}

const DAY_MS = 86_400_000;

const costPerLead = (spend: number, leads: number): Kopecks | null => (leads === 0 ? null : Math.round(spend / leads));
const totals = (spend: number, leads: number): RunTotals => ({ spend, leads, costPerLead: costPerLead(spend, leads) });

const CHECK_TITLES: Record<CheckKey, string> = {
  pause: "Отключил рекламу, которая не приносит клиентов",
  scale: "Добавил денег рекламе, которая приносит клиентов",
  experiment: "Проверил новый вариант объявления и оставил лучший",
  cabinet: "Показал в истории правку из кабинета Директа",
  rollback: "Вы отменили изменение одной кнопкой",
  budget: "Бюджет ни разу не превышен",
};

/** A decision of the agent or of a safety-net rule; the budget guard's cuts and the owner's changes are not. */
const byService = (c: ChangeEntry): boolean => c.author === "service" && (c.actor === "agent" || c.actor === "safety_net");

/**
 * «На самом деле: …» (simulation-mode spec «Экран решений»): the cost per lead of the scenario's hidden truth for the
 * insight's ad or advertising, against the goal the decision was made with (the launch goal when the insight has none).
 * Advertising is all of its ads, weighted by their clicks.
 */
export const scenarioTruth =
  (input: { simulation: SimulationRecord; ads: readonly AdRecord[]; goal: Kopecks }) =>
  (ref: NonNullable<InsightRecord["objectRef"]>, decisionGoal: Kopecks | null = null): TruthLine | null => {
    const truths = new Map(input.simulation.state.truths);
    const ads = ref.kind === "ad" ? input.ads.filter((a) => a.id === ref.id) : input.ads.filter((a) => a.directionId === ref.id);
    let cost = 0;
    let leads = 0;
    let known = false;
    for (const ad of ads) {
      const truth = truths.get(ad.platformAdId);
      if (!truth) continue;
      known = true;
      const clicks = truth.impressionsPerDay * truth.ctr;
      cost += clicks * truth.costPerClick;
      leads += clicks * truth.cr;
    }
    if (!known) return null;
    if (leads === 0) {
      return { text: `На самом деле: ${ref.kind === "ad" ? "объявление" : "эта реклама"} не приводит обращений`, tone: "danger" };
    }
    const cpl = Math.round(cost / leads);
    const target = decisionGoal ?? input.goal;
    const goal = formatRub(target);
    if (cpl <= target) return { text: `На самом деле: обращение примерно за ${formatRub(cpl)} — в пределах цели ${goal}`, tone: "success" };
    return { text: `На самом деле: обращение примерно за ${formatRub(cpl)} — дороже цели ${goal}`, tone: cpl <= target * 1.5 ? "warning" : "danger" };
  };

/** Pure: the comparison, the result and the checklist, from the simulation's market state and the service's records. */
export const buildDecisionScreen = (input: DecisionScreenInput): DecisionScreenModel => {
  const { simulation, timeZone } = input;
  const start = toLocalDate(simulation.startedAt, timeZone);
  const totalDays = Math.round((simulation.endsAt.getTime() - simulation.startedAt.getTime()) / DAY_MS);
  const day = Math.min(totalDays, Math.floor((simulation.simNow.getTime() - simulation.startedAt.getTime()) / DAY_MS) + 1);
  const ended = simulation.simNow.getTime() + 3_600_000 > simulation.endsAt.getTime();
  const dayOf = (at: Date) => Math.floor((at.getTime() - simulation.startedAt.getTime()) / DAY_MS) + 1;
  const scenario = isScenarioId(simulation.scenario) ? SCENARIOS[simulation.scenario] : null;

  // Real money and leads of the service's run by date, including statistics the service has not received yet.
  const campaignIds = new Set(input.directions.map((d) => d.platformCampaignId));
  const realByDay = new Map<LocalDate, { spend: number; leads: number }>();
  for (const cell of simulation.state.cells) {
    if (!campaignIds.has(cell.campaignId)) continue;
    const known = realByDay.get(cell.date) ?? { spend: 0, leads: 0 };
    realByDay.set(cell.date, { spend: known.spend + cell.spend, leads: known.leads + cell.leads });
  }

  const today = toLocalDate(simulation.simNow, timeZone);
  // After the last day the clock stands at the next morning: those hours are not a day of the scenario.
  const lastDay = ended ? addDays(start, totalDays - 1) : today;
  const spentByMonth = new Map<string, number>();
  let exceeded = false;
  for (let date = start; date <= lastDay; date = addDays(date, 1)) {
    const spent = (spentByMonth.get(monthKey(date)) ?? 0) + (realByDay.get(date)?.spend ?? 0);
    spentByMonth.set(monthKey(date), spent);
    exceeded ||= spent > monthBudget(input.monthlyBudgetRub, start, date);
  }

  let comparison: Comparison | null = null;
  const baseline = simulation.baseline;
  if (baseline !== null && Array.isArray(baseline.daily)) {
    const shown = Math.min(day, baseline.daily.length);
    const service: number[] = [];
    const base: number[] = [];
    let serviceSpend = 0;
    let baseSpend = 0;
    for (let i = 0; i < shown; i++) {
      const real = realByDay.get(addDays(start, i));
      serviceSpend += real?.spend ?? 0;
      service.push((service.at(-1) ?? 0) + (real?.leads ?? 0));
      baseSpend += baseline.daily[i]?.spend ?? 0;
      base.push((base.at(-1) ?? 0) + (baseline.daily[i]?.leads ?? 0));
    }
    comparison = { service, baseline: base, serviceNow: totals(serviceSpend, service.at(-1) ?? 0), baselineNow: totals(baseSpend, base.at(-1) ?? 0) };
  }

  const applied = input.changes.filter((c) => c.status === "applied");
  const first = (test: (c: ChangeEntry) => boolean) => applied.find(test)?.id ?? null;
  const proofs: Record<ScenarioShowKey, string | null> = {
    pause: first((c) => byService(c) && (c.action.type === "PauseAd" || c.action.type === "PauseDirection")),
    scale: first((c) => byService(c) && c.action.type === "SetSpendLimit" && Number(c.after.weeklyLimit) > Number(c.before.weeklyLimit)),
    experiment: first((c) => c.action.type === "FinishExperiment"),
    cabinet: first((c) => c.author === "cabinet"),
  };
  const promised = new Map((scenario?.shows ?? []).map((p) => [p.key, p.byDay]));
  const checklist: CheckItem[] = [];
  for (const key of ["pause", "scale", "experiment", "cabinet"] as const) {
    const byDay = promised.get(key);
    const entryId = proofs[key];
    // An item the scenario does not promise appears only once the service has done it.
    if (byDay === undefined && entryId === null) continue;
    checklist.push({ key, title: CHECK_TITLES[key], done: entryId !== null, entryId, hint: entryId === null && byDay !== undefined ? `Обычно к ${byDay}-му дню` : null });
  }
  const reverted = applied.find((c) => c.revertedById !== null);
  checklist.push({
    key: "rollback",
    title: CHECK_TITLES.rollback,
    done: reverted !== undefined,
    entryId: reverted?.revertedById ?? null,
    hint: reverted ? null : "Откатите любое изменение в истории или в ленте — кнопка «Вернуть как было»",
  });
  checklist.push({ key: "budget", title: CHECK_TITLES.budget, done: !exceeded, entryId: null, hint: exceeded ? "Расходы месяца вышли за бюджет — это ошибка, напишите нам" : null });

  let result: RunResult | null = null;
  if (ended && baseline !== null) {
    const until = addDays(start, baseline.days - 1);
    let spend = 0;
    let leads = 0;
    for (const [date, real] of realByDay) {
      if (date <= until) {
        spend += real.spend;
        leads += real.leads;
      }
    }
    result = { days: baseline.days, service: totals(spend, leads), baseline: totals(baseline.spend, baseline.leads) };
  }

  const decisionDays = [...new Set(applied.filter((c) => c.author === "service" && isAdDecision(c)).map((c) => dayOf(c.createdAt)))];
  return { day, totalDays, scenarioTitle: scenario?.title ?? "", comparison, decisionDays, checklist, result };
};
