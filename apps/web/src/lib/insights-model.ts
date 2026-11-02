import { addDays, toLocalDate } from "@impuls/core";
import type { InsightFact, InsightMetric, InsightPeriod, LocalDate } from "@impuls/core";
import type { HypothesisRecord, InsightRecord, TurnDigest } from "@impuls/worker";
import { QUIET_DAY_CODE, RULES_DAY_CODE } from "@impuls/worker/change-kinds";
import type { ExperimentItem } from "./experiments-model";
import { formatCount, formatRub, sentence } from "./format";
import type { HistoryItem, Names } from "./history-view";

export type InsightAuthor = InsightRecord["source"];

/** Who made the decision (insights spec «Инсайт»). */
export const INSIGHT_AUTHORS: Record<InsightAuthor, string> = {
  agent: "Сервис",
  rule: "Сервис, страховочное правило",
};

export const DECISION_LABELS: Record<Exclude<InsightRecord["decision"]["status"], "none">, { text: string; tone: "success" | "warning" | "danger" }> = {
  applied: { text: "Применено", tone: "success" },
  clamped: { text: "Урезано", tone: "warning" },
  rejected: { text: "Отклонено", tone: "danger" },
};

/** «На самом деле: …» on the simulation screen: the scenario's hidden truth about the insight's object. */
export interface TruthLine {
  text: string;
  tone: "success" | "warning" | "danger";
}

/** One fact of «На каких данных»: what, about what and for which time, and its value from the turn's snapshot. */
export interface InsightFactView {
  label: string;
  value: string;
}

export interface InsightCardModel {
  id: string;
  author: InsightAuthor;
  at: string;
  observation: string;
  facts: InsightFactView[];
  decision: { text: string; status: InsightRecord["decision"]["status"] };
  next: string;
  /** The history entry «Вернуть как было» rolls back, while it still can be rolled back. */
  rollback: HistoryItem | null;
  truth: TruthLine | null;
  /** Ads and advertising the insight is about, from its object and fact keys: the week story lights their rows. */
  objectIds: string[];
}

/** «Разбор 8 ноября»: the agent's review of the day and the insights of that day, newest first. */
export interface DayReviewModel {
  date: string;
  /**
   * The first of consecutive days on which the rules decided alone for one reason and changed nothing, or of quiet days
   * in a row without insights; else null.
   */
  from: string | null;
  /** The agent's message to the owner, when it passed the checks. */
  summary: string | null;
  /** A turn with no insights: «Посмотрели рекламу — менять ничего не нужно». */
  quiet: boolean;
  /** No turn that day: «Сегодня решения принимали страховочные правила: …». */
  rulesReason: string | null;
  insights: InsightCardModel[];
  /** «Разбор недели» of a Monday (insights spec «Разбор недели в ленте»); null on other days. */
  weekly: WeeklyReviewModel | null;
}

export interface HypothesisCardModel {
  id: string;
  statement: string;
  check: string;
  checkOn: string;
  /** «подтвердилась», «не подтвердилась», «снята»; null while it is being checked. */
  outcome: string | null;
  result: string | null;
}

export interface WeeklyReviewModel {
  /** The agent's message, when it passed the checks. */
  summary: string | null;
  /** «Проверяем»: open at the end of that day, with the day of the check. */
  checking: HypothesisCardModel[];
  /** «Выяснили»: closed in the 7 days up to that day, with the result. */
  found: HypothesisCardModel[];
  insights: InsightCardModel[];
}

const HYPOTHESIS_OUTCOMES: Record<HypothesisRecord["status"], string | null> = {
  checking: null,
  confirmed: "подтвердилась",
  rejected: "не подтвердилась",
  dropped: "снята",
};

const toHypothesisCard = (h: HypothesisRecord): HypothesisCardModel => ({
  id: h.id,
  statement: h.statement,
  check: h.check,
  checkOn: h.checkOn,
  outcome: HYPOTHESIS_OUTCOMES[h.status],
  result: h.result,
});

export interface InsightFeedModel {
  timeZone: string;
  /** The running A/B check, first in the feed as «Сейчас проверяем» (analytics spec). */
  check: { item: ExperimentItem; minDays: number; maxDays: number; minClicks: number } | null;
  days: DayReviewModel[];
  /** For the rollback dialog of a card. */
  names: Names;
}

export const QUIET_DAY = "Посмотрели рекламу — менять ничего не нужно";
/** The same for quiet days in a row: «С 3 по 6 декабря — посмотрели рекламу, менять ничего не нужно». */
export const QUIET_DAYS = "посмотрели рекламу, менять ничего не нужно";

const METRICS: Record<InsightMetric, string> = {
  spend: "расход",
  impressions: "показы",
  clicks: "переходы на сайт",
  leads: "обращения",
  cost_per_lead: "цена обращения",
  weekly_limit: "недельный лимит",
  budget: "бюджет месяца",
  budget_spent: "потрачено в этом месяце",
  budget_left: "осталось в этом месяце",
  budget_pace: "ровный расход к сегодняшнему дню",
  goal: "цель",
};

const PERIODS: Record<InsightPeriod, string> = {
  "14d": "за 14 дней",
  "7d": "за последние 7 дней",
  prev7d: "за 7 дней до этого",
  month: "",
  now: "",
  check: "за время проверки",
};

/** The budget and the goal name themselves; everything else says about what the number is. */
const SELF_NAMED = new Set<InsightMetric>(["budget", "budget_spent", "budget_left", "budget_pace", "goal"]);

/** «Объявление «Маникюр без записи»: расход за 14 дней» */
export const factLabel = (fact: Pick<InsightFact, "object" | "metric" | "period">): string => {
  const what = [METRICS[fact.metric], PERIODS[fact.period]].filter((p) => p !== "").join(" ");
  return SELF_NAMED.has(fact.metric) ? sentence(what) : `${sentence(fact.object)}: ${what}`;
};

/** «1 530 ₽», «0», «500 ₽ за обращение» */
export const factValue = (fact: Pick<InsightFact, "metric" | "unit" | "value">): string => {
  if (fact.unit === "count") return formatCount(fact.value);
  const rub = formatRub(fact.value * 100);
  if (fact.metric === "goal") return `${rub} за обращение`;
  return fact.metric === "weekly_limit" ? `${rub} в неделю` : rub;
};

/**
 * The scenario's truth about an insight's object, on the simulation screen only, against the goal the decision was made
 * with (in kopecks; null when the insight has no goal fact).
 */
export type TruthOf = (ref: NonNullable<InsightRecord["objectRef"]>, goal: number | null) => TruthLine | null;

/**
 * The days of the feed (insights spec «Разбор дня»), newest first: a day with a completed turn shows the agent's
 * checked review, or one line when it found nothing to change; a day without a turn says why the rules decided alone.
 * Consecutive days on which the rules decided alone for one reason and changed nothing make one line, so that the feed
 * keeps saying why there are no reviews without repeating it every day. A day without reasons for the agent is quiet,
 * and quiet days in a row without insights make one line too (ad-agent «Поводы для хода агента»).
 */
export const feedDays = (input: {
  insights: readonly InsightRecord[];
  turns: readonly TurnDigest[];
  timeZone: string;
  since: LocalDate | null;
  /** History entries by id, for «Вернуть как было». */
  entries: ReadonlyMap<string, HistoryItem>;
  truthOf?: TruthOf;
  /** The agent's hypothesis journal, for «Разбор недели». */
  hypotheses?: readonly HypothesisRecord[];
}): DayReviewModel[] => {
  const days = new Map<LocalDate, { records: InsightRecord[]; marker: InsightRecord | null; quiet: boolean; turns: TurnDigest[] }>();
  const day = (at: Date) => {
    const date = toLocalDate(at, input.timeZone);
    const known = days.get(date) ?? { records: [], marker: null, quiet: false, turns: [] };
    days.set(date, known);
    return known;
  };
  for (const record of input.insights) {
    const d = day(record.createdAt);
    if (record.reasonCode === RULES_DAY_CODE) d.marker = record;
    else if (record.reasonCode === QUIET_DAY_CODE) d.quiet = true;
    else d.records.push(record);
  }
  for (const turn of input.turns) {
    if (turn.status === "completed") day(turn.startedAt).turns.push(turn);
  }
  const reviews: DayReviewModel[] = [];
  for (const [date, d] of [...days].sort(([a], [b]) => b.localeCompare(a))) {
    if (input.since !== null && date < input.since) continue;
    if (d.turns.length === 0 && d.records.length === 0 && d.marker === null) {
      if (!d.quiet) continue;
      const newer = reviews.at(-1);
      // Days go newest first: a quiet day right before a quiet line extends it.
      if (newer && newer.quiet && newer.insights.length === 0 && newer.summary === null && newer.rulesReason === null && newer.weekly === null && addDays(date, 1) === (newer.from ?? newer.date)) {
        newer.from = date;
        continue;
      }
      reviews.push({ date, from: null, summary: null, quiet: true, rulesReason: null, insights: [], weekly: null });
      continue;
    }
    if (d.turns.length === 0 && d.records.length === 0) {
      if (d.marker === null) continue;
      const reason = d.marker.observation;
      const newer = reviews.at(-1);
      // Days go newest first: this day extends the newer line when it is the day right before it, for the same reason.
      if (newer && newer.insights.length === 0 && newer.summary === null && newer.rulesReason !== null && addDays(date, 1) === (newer.from ?? newer.date) && sameReason(newer.rulesReason, reason)) {
        newer.from = date;
        newer.rulesReason = rangeReason(reason);
        continue;
      }
      reviews.push({ date, from: null, summary: null, quiet: false, rulesReason: reason, insights: [], weekly: null });
      continue;
    }
    const card = (record: InsightRecord): InsightCardModel => {
      const rollback = record.decision.changeIds.map((id) => input.entries.get(id)).find((item) => item?.rollback.kind === "available") ?? null;
      const goal = record.facts.find((f) => f.metric === "goal");
      return toInsightCard(record, rollback, record.objectRef && input.truthOf ? input.truthOf(record.objectRef, goal ? goal.value * 100 : null) : null);
    };
    // The weekly review is a group of its own; the day's review and insights are the other turns' (insights spec).
    const weeklyTurn = [...d.turns].reverse().find((t) => t.trigger === "weekly_review");
    const records = d.records.filter((r) => weeklyTurn === undefined || r.turnId !== weeklyTurn.id);
    const latest = [...d.turns].reverse().filter((t) => t.trigger !== "weekly_review");
    const review = latest.find((t) => t.trigger === "daily_review" && t.summaryValid) ?? latest.find((t) => t.summaryValid);
    const localDay = (at: Date) => toLocalDate(at, input.timeZone);
    const journal = input.hypotheses ?? [];
    reviews.push({
      date,
      from: null,
      summary: review?.summary ?? null,
      // A quiet day keeps its line above the rules' insights of that day.
      quiet: (records.length === 0 && latest.length > 0) || (d.quiet && latest.length === 0),
      rulesReason: d.turns.length === 0 ? (d.marker?.observation ?? null) : null,
      insights: [...records].reverse().map(card),
      weekly:
        weeklyTurn === undefined
          ? null
          : {
              summary: weeklyTurn.summaryValid ? weeklyTurn.summary : null,
              checking: journal.filter((h) => localDay(h.openedAt) <= date && (h.closedAt === null || localDay(h.closedAt) > date)).map(toHypothesisCard),
              found: journal
                .filter((h) => h.closedAt !== null && localDay(h.closedAt) <= date && localDay(h.closedAt) > addDays(date, -7))
                .map(toHypothesisCard),
              insights: d.records.filter((r) => r.turnId === weeklyTurn.id).reverse().map(card),
            },
    });
  }
  return reviews;
};

/** «Сегодня решения принимали…» of one day as the line of several days: «Решения принимали…». */
const rangeReason = (reason: string): string => reason.replace(/^Сегодня решения/, "Решения");
const sameReason = (a: string, b: string): boolean => rangeReason(a) === rangeReason(b);

/** A stored insight as its card; the values of the facts are the snapshot's, never the agent's text. */
export const toInsightCard = (record: InsightRecord, rollback: HistoryItem | null, truth: TruthLine | null): InsightCardModel => ({
  id: record.id,
  author: record.source,
  at: record.createdAt.toISOString(),
  observation: record.observation,
  facts: record.facts.map((f) => ({ label: factLabel(f), value: factValue(f) })),
  decision: { text: record.decision.text, status: record.decision.status },
  next: record.next,
  rollback,
  truth,
  objectIds: objectIdsOf(record),
});

/** `ad:<id>:…`, `direction:<id>:…` and `segment:<direction>:…` fact keys name their objects; so does the object ref. */
const objectIdsOf = (record: InsightRecord): string[] => {
  const ids = new Set<string>(record.objectRef ? [record.objectRef.id] : []);
  for (const fact of record.facts) {
    const [kind, id] = fact.key.split(":");
    if ((kind === "ad" || kind === "direction" || kind === "segment") && id) ids.add(id);
  }
  return [...ids];
};
