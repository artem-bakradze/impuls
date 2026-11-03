import { addDays, classify, costPerLead, daysBetween, toLocalDate } from "@impuls/core";
import type { EffectivenessClass, Kopecks, LocalDate, PerformanceStats } from "@impuls/core";
import type { AdRecord, ChangeEntry, DirectionRecord, InsightRecord, SimulationRecord } from "@impuls/worker";
import type { DailyStatRow } from "@impuls/platforms";
import { isStepComplete, readWeekReport } from "@impuls/worker/simulation-report";
import { buildDecisionScreen, scenarioTruth } from "./simulation-screen";
import { actualActionText, describeDiff, objectName } from "./history-view";
import { feedDays, toInsightCard } from "./insights-model";
import { isBudgetAdjustment } from "@impuls/worker/change-kinds";
import type { HistoryItem } from "./history-view";
import type { DayReviewModel, InsightCardModel, TruthLine } from "./insights-model";
import type { Comparison } from "./simulation-screen";

/** The service's estimate of an ad in plain words (simulation-mode spec «История недели»); the class is the rules'. */
export const VERDICT_WORDS: Record<EffectivenessClass, string> = {
  learning: "собираем данные",
  effective: "приводит клиентов",
  borderline: "на грани",
  ineffective: "не приводит клиентов",
};

export interface WeekRow {
  adId: string;
  directionId: string;
  title: string;
  channel: "search" | "network";
  /** The ad appeared during the week — a new variant of a check, say. */
  added: boolean;
  spend: Kopecks;
  clicks: number;
  leads: number;
  costPerLead: Kopecks | null;
  verdict: EffectivenessClass;
  truth: TruthLine | null;
}

export interface WeekDecision {
  item: HistoryItem;
  /** The decision's insight: what was noticed and the guard's answer. */
  insight: InsightCardModel | null;
}

/** One lived week as three scenes: what happened, how the service reviewed it, what it decided. */
export interface WeekStoryModel {
  savedAt?: string | undefined;
  reconstructed?: boolean;
  quietDays?: number;
  week: number;
  from: LocalDate;
  to: LocalDate;
  /** Spend and leads of each day of the week, for the counters that grow day by day. */
  days: { date: LocalDate; spend: Kopecks; leads: number }[];
  totals: { spend: Kopecks; leads: number; costPerLead: Kopecks | null };
  rows: WeekRow[];
  /** The week's day reviews, newest first, quiet days folded. */
  reviews: DayReviewModel[];
  decisions: WeekDecision[];
  /** Why nothing was changed, when nothing was. */
  noDecisionReason: string | null;
  /** Leads of the week with the service and without it, and since the start. */
  comparison: { serviceWeek: number; baselineWeek: number; serviceTotal: number; baselineTotal: number } | null;
  /** Every lived week, for «посмотреть снова». */
  weeks: { week: number; from: LocalDate; to: LocalDate }[];
}

export interface WeekStoryInput {
  simulation: SimulationRecord;
  week: number;
  timeZone: string;
  directions: readonly DirectionRecord[];
  ads: readonly AdRecord[];
  /** The service's statistics from 13 days before the week up to its last day. */
  stats: readonly DailyStatRow[];
  /** The goal per lead at the end of the week, for the classes. */
  cso: Kopecks;
  truthOf: (ref: NonNullable<InsightRecord["objectRef"]>, goal: Kopecks | null) => TruthLine | null;
  reviews: readonly DayReviewModel[];
  history: readonly HistoryItem[];
  changes: readonly ChangeEntry[];
  comparison: Comparison | null;
}

const empty = (): PerformanceStats => ({ impressions: 0, clicks: 0, leads: 0, spend: 0 });
const add = (a: PerformanceStats, r: DailyStatRow): PerformanceStats => ({ impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks, leads: a.leads + r.leads, spend: a.spend + r.spend });

/**
 * The windows of the lived weeks, numbered from 1. A step runs from a morning to the same hour a week later: its days
 * are the dates from its first one to the day before it ends, and the morning it ends on — the review of those days —
 * belongs to it too (`reviewedOn`).
 */
export const livedWeeks = (
  simulation: SimulationRecord,
  timeZone: string,
): { week: number; from: LocalDate; to: LocalDate; reviewedOn: LocalDate; start: Date; end: Date; report?: string | undefined }[] =>
  simulation.steps
    .filter((s) => s.kind === "week" && isStepComplete(s, simulation))
    .map((s, index) => {
      const from = toLocalDate(s.from, timeZone);
      const reviewedOn = toLocalDate(s.to, timeZone);
      return { week: index + 1, from, to: reviewedOn > from ? addDays(reviewedOn, -1) : from, reviewedOn, start: s.from, end: s.to, ...(s.report !== undefined && { report: s.report }) };
    });

/**
 * Pure: the week story from what is saved — the service's statistics, the rules' classes, the day reviews, the
 * history — so it reads the same whenever it is opened again (simulation-mode spec «История недели»).
 */
export const buildWeekStory = (initial: WeekStoryInput): WeekStoryModel | null => {
  let input = initial;
  const weeks = livedWeeks(input.simulation, input.timeZone);
  const window = weeks.find((w) => w.week === input.week);
  if (window === undefined) return null;
  if (window.report !== undefined) {
    const saved = readWeekReport(window.report);
    const simulation = { ...input.simulation, simNow: new Date(saved.at), endsAt: new Date(saved.endsAt), baseline: saved.baseline, state: { ...input.simulation.state, truths: saved.truths } };
    const truthOf = scenarioTruth({ simulation, ads: saved.ads, goal: saved.cso });
    const names = { directions: Object.fromEntries(saved.directions.map((d) => [d.id, d.name])), channels: Object.fromEntries(saved.directions.map((d) => [d.id, d.channel])), ads: Object.fromEntries(saved.ads.map((a) => [a.id, a.title])), strategies: {} };
    const current = new Map(input.history.map((h) => [h.id, h]));
    const records = new Map(saved.insights.map((r) => [r.id, r]));
    const history: HistoryItem[] = saved.changes.map((c) => {
      const live = current.get(c.id);
      const insight = c.insightId ? records.get(c.insightId) : undefined;
      return {
        id: c.id, at: c.createdAt.toISOString(), author: c.author, object: objectName(c.objectKind, c.objectId, names),
        diff: describeDiff(c.before, c.after, names), decisionText: actualActionText(c), explanation: c.explanation, outcome: c.outcome, turnId: c.turnId,
        insight: insight ? toInsightCard(insight, null, null) : null, status: c.status, reverted: live?.reverted ?? c.revertedById !== null,
        rollback: live?.rollback ?? { kind: "unavailable", reason: "Запись сохранена в отчёте; откройте текущую историю для отмены." }, budgetAdjustment: isBudgetAdjustment(c),
      };
    });
    input = {
      ...input, directions: saved.directions, ads: saved.ads, stats: saved.stats, cso: saved.cso, truthOf, history, changes: saved.changes,
      reviews: feedDays({ insights: saved.insights, turns: saved.turns, hypotheses: saved.hypotheses, timeZone: input.timeZone, launchedOn: toLocalDate(simulation.startedAt, input.timeZone), since: null, entries: new Map(history.map((h) => [h.id, h])), truthOf }),
      comparison: buildDecisionScreen({ simulation, timeZone: input.timeZone, monthlyBudgetRub: saved.monthlyBudgetRub, directions: saved.directions, changes: saved.changes, fullDaily: saved.fullDaily, observed: saved.stats }).comparison,
    };
  }

  const inWeek = (date: LocalDate) => date >= window.from && date <= window.to;
  const days: WeekStoryModel["days"] = [];
  for (let date = window.from; date <= window.to; date = addDays(date, 1)) {
    const rows = input.stats.filter((r) => r.date === date);
    days.push({ date, spend: rows.reduce((s, r) => s + r.spend, 0), leads: rows.reduce((s, r) => s + r.leads, 0) });
  }
  const spend = days.reduce((s, d) => s + d.spend, 0);
  const leads = days.reduce((s, d) => s + d.leads, 0);

  // The classes as the morning evaluation after the week saw them: 14 days up to its last day.
  const evaluatedOn = addDays(window.to, 1);
  const since14 = addDays(window.to, -13);
  const channels = new Map(input.directions.map((d) => [d.id, d.channel]));
  // Only what the week itself holds: the ads that spent in it or appeared in it, never today's state of an ad, so the
  // story reads the same when it is opened again weeks later.
  const rows: WeekRow[] = input.ads
    .filter((ad) => ad.createdOn <= window.to)
    .map((ad) => {
      const own = input.stats.filter((r) => r.adId === ad.platformAdId);
      const week = own.filter((r) => inWeek(r.date)).reduce(add, empty());
      const stats14 = own.filter((r) => r.date >= since14 && r.date <= window.to).reduce(add, empty());
      return {
        adId: ad.id,
        directionId: ad.directionId,
        title: ad.title,
        channel: channels.get(ad.directionId) ?? "search",
        added: ad.createdOn >= window.from,
        spend: week.spend,
        clicks: week.clicks,
        leads: week.leads,
        costPerLead: costPerLead(week),
        verdict: classify(stats14, daysBetween(ad.createdOn, evaluatedOn), input.cso),
        truth: input.truthOf({ kind: "ad", id: ad.id }, null),
      };
    })
    .filter((row) => row.spend > 0 || row.added)
    .sort((a, b) => b.spend - a.spend);

  const byService = (c: ChangeEntry) => c.author === "service" && (c.actor === "agent" || c.actor === "safety_net");
  const items = new Map(input.history.map((i) => [i.id, i]));
  const decisions = input.changes
    .filter((c) => c.status === "applied" && byService(c) && !isBudgetAdjustment(c) && c.createdAt >= window.start && c.createdAt < window.end)
    .map((c) => items.get(c.id))
    .filter((item): item is HistoryItem => item !== undefined)
    .map((item) => ({ item, insight: item.insight }));

  // The mornings after the week's days, up to the one it ended on; the launch day's reviews belong to the first week.
  const firstReviewed = window.week === 1 ? window.from : addDays(window.from, 1);
  const reviews = input.reviews.filter((r) => r.date >= firstReviewed && (r.from ?? r.date) <= window.reviewedOn);
  const actionDates = new Set(input.changes.filter((c) => c.status === "applied" && byService(c) && !isBudgetAdjustment(c)).map((c) => toLocalDate(c.createdAt, input.timeZone)));
  const quietDates = new Set<string>();
  for (const review of reviews) {
    if (!review.quiet || review.insights.length > 0 || (review.weekly?.insights.length ?? 0) > 0) continue;
    for (let date = review.from ?? review.date; date <= review.date; date = addDays(date, 1)) {
      if (date >= window.from && date <= window.to && !actionDates.has(date)) quietDates.add(date);
    }
  }
  const watching = reviews.flatMap((r) => r.insights).find((i) => i.decision.status === "none");
  const noDecisionReason =
    decisions.length > 0
      ? null
      : rows.length > 0 && rows.every((r) => r.verdict === "learning")
        ? "Объявления ещё собирали данные: решения сервис принимает, когда данных достаточно."
        : (watching?.decision.text ?? "Сервис смотрел рекламу каждое утро — поводов что-то менять не было.");

  let comparison: WeekStoryModel["comparison"] = null;
  if (input.comparison !== null) {
    const startDay = Math.round((Date.parse(`${window.from}T00:00:00Z`) - Date.parse(`${toLocalDate(input.simulation.startedAt, input.timeZone)}T00:00:00Z`)) / 86_400_000);
    const endDay = startDay + days.length - 1;
    const at = (series: number[], index: number) => (index < 0 ? 0 : (series[Math.min(index, series.length - 1)] ?? 0));
    comparison = {
      serviceWeek: at(input.comparison.service, endDay) - at(input.comparison.service, startDay - 1),
      baselineWeek: at(input.comparison.baseline, endDay) - at(input.comparison.baseline, startDay - 1),
      serviceTotal: at(input.comparison.service, endDay),
      baselineTotal: at(input.comparison.baseline, endDay),
    };
  }

  return {
    savedAt: window.report === undefined ? undefined : readWeekReport(window.report).at,
    reconstructed: window.report === undefined,
    quietDays: quietDates.size,
    week: window.week,
    from: window.from,
    to: window.to,
    days,
    totals: { spend, leads, costPerLead: leads === 0 ? null : Math.round(spend / leads) },
    rows,
    reviews,
    decisions,
    noDecisionReason,
    comparison,
    weeks: weeks.map(({ week, from, to }) => ({ week, from, to })),
  };
};
