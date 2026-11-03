import { addDays, classify, costPerLead, daysBetween, toLocalDate } from "@impuls/core";
import type { EffectivenessClass, Kopecks, LocalDate, PerformanceStats } from "@impuls/core";
import type { DailyStatRow } from "@impuls/platforms";
import type { AdRecord, ChangeEntry, DirectionRecord } from "@impuls/worker";
import { isBudgetAdjustment } from "@impuls/worker/change-kinds";
import { formatRub } from "./format";
import type { HistoryItem } from "./history-view";
import type { DayReviewModel, InsightCardModel, TruthLine } from "./insights-model";
import { QUIET_DAY, QUIET_DAYS } from "./insights-model";

/** What the service last changed about an ad or its advertising, said plainly, with the journal record that tells why. */
export interface ChangeMark {
  text: string;
  date: LocalDate;
  entryId: string | null;
}

/** An ad people see now (simulation-mode spec «Экран «Что делает сервис»»), with its last 7 days of received reports. */
export interface ShownAd {
  id: string;
  directionId: string;
  title: string;
  text: string;
  channel: "search" | "network";
  /** The rules' estimate over 14 days, as the morning evaluation sees it. */
  verdict: EffectivenessClass;
  /** Appeared in the last 7 days: a new variant of a check, say. */
  fresh: boolean;
  pending: boolean;
  /** One side of the running A/B check. */
  checking: boolean;
  clicks: number;
  leads: number;
  change: ChangeMark | null;
}

export interface JournalChange {
  text: string;
  reverted: boolean;
  /** The history entry, for «Вернуть как было» (change-history spec «Откат изменения»). */
  historyId: string | null;
  item: HistoryItem | null;
  /** The facts the decision rests on, behind its one disclosure. */
  facts: { label: string; value: string }[];
  /** The agent turn, for «Как сервис принял это решение». */
  turnId: string | null;
}

/** One record of the agent's journal: the gist in one line, then its own words, checks and what it learned. */
export interface JournalEntry {
  id: string;
  date: LocalDate;
  /** The first day of a folded line of quiet or rules-only days. */
  from: LocalDate | null;
  day: number;
  /** «owner»: a change by the owner or in the Direct cabinet, which the journal shows as history too. */
  kind: "agent" | "rules" | "quiet" | "owner";
  weekly: boolean;
  /** The first sentence of a record without changes; with changes, the changes are the gist. */
  headline: string | null;
  paragraphs: string[];
  changes: JournalChange[];
  checking: { statement: string; checkOn: LocalDate }[];
  found: { statement: string; outcome: string; result: string | null }[];
  truths: TruthLine[];
  /** Ads and advertising the entry is about. */
  objectIds: string[];
}

export interface JournalSection {
  /** The lived week's number; null for days lived one by one, outside a week step. */
  week: number | null;
  from: LocalDate;
  to: LocalDate;
  entries: JournalEntry[];
}

/** «Неделя 2 в двух словах»: what the service did, what it checks and what the week brought. */
export interface WeekBrief {
  week: number;
  from: LocalDate;
  to: LocalDate;
  changes: string[];
  checks: { count: number; nextOn: LocalDate | null };
  leads: number;
  spend: Kopecks;
  costPerLead: Kopecks | null;
  goal: Kopecks;
}

export interface ServiceWorkInput {
  ads: readonly AdRecord[];
  directions: readonly DirectionRecord[];
  /** The service's statistics of the run. */
  stats: readonly DailyStatRow[];
  today: LocalDate;
  startedOn: LocalDate;
  timeZone: string;
  /** The goal per lead the rules estimate the ads with. */
  cso: Kopecks;
  /** The insight feed of the whole run, newest first. */
  reviews: readonly DayReviewModel[];
  history: readonly HistoryItem[];
  changes: readonly ChangeEntry[];
  /** Both sides of the running A/B check, by title and text. */
  checkAds?: readonly { title: string; text: string }[];
  /** The hypotheses being checked now. */
  openChecks: readonly { checkOn: LocalDate }[];
  weeks: readonly { week: number; from: LocalDate; reviewedOn: LocalDate }[];
}

export interface ServiceWorkModel {
  shown: ShownAd[];
  /** Ads that are not shown: one line under the shown ones, with «Включить». */
  hidden: { id: string; title: string; paused: boolean }[];
  /** The last change of each advertising as a whole, shown above its ads. */
  directionChanges: (ChangeMark & { channel: "search" | "network" })[];
  journal: JournalSection[];
  brief: WeekBrief | null;
}

/** Words the owner does not use, in the agent's own text: the stop-list of `change-history`, for the journal. */
const PLAIN: [RegExp, string][] = [
  [/(^|[^а-яё])инсайт(ы|ов|ами|ах)(?![а-яё])/gi, "$1наблюдения"],
  [/(^|[^а-яё])инсайт(а|у|ом|е)?(?![а-яё])/gi, "$1наблюдение"],
  [/на (\d+) пункт(а|ов)?(?![а-яё])/gi, "на $1%"],
];

/** «**Разбор недели:** …» → «…»: the journal is the agent's speech, not a card with a heading. */
export const speech = (summary: string): string[] =>
  summary
    .replace(/\*\*/g, "")
    .replace(/^\s*Разбор (дня|недели)\s*[:.—-]\s*/i, "")
    .split(/\n\s*\n/)
    .map((p) => plain(p.replace(/\s+/g, " ").trim()))
    .filter((p) => p.length > 0)
    .map((p) => `${p[0]?.toUpperCase() ?? ""}${p.slice(1)}`);

const plain = (text: string): string => PLAIN.reduce((t, [pattern, word]) => t.replace(pattern, word), text);

/** An insight's observation as a sentence of the journal, in the same plain words. */
const sentenceCase = (text: string): string => `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;
const lowerFirst = (text: string): string => `${text[0]?.toLowerCase() ?? ""}${text.slice(1)}`;

const withStop = (text: string): string => plain(/[.!?…»]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/** The first sentence and the rest; a number like «1,5» or «т. д.» does not end a sentence. */
const firstSentence = (text: string): [string, string] => {
  const match = /^(.+?[.!?…])\s+(?=[А-ЯЁA-Z«])/.exec(text);
  return match ? [match[1] ?? text, text.slice(match[0].length)] : [text, ""];
};

const quoted = (phrases: readonly string[]): string => `${phrases.slice(0, 2).map((p) => `«${p}»`).join(", ")}${phrases.length > 2 ? ` и ещё ${phrases.length - 2}` : ""}`;

/** A change in the owner's words, first person like the agent's text: «Поднял цену перехода с компьютеров на 10%». */
export const changeHeadline = (c: ChangeEntry, directions: ReadonlyMap<string, DirectionRecord>, adTitles: ReadonlyMap<string, string>): string | null => {
  const action = c.action;
  const where = (directionId: string) => (directions.get(directionId)?.channel === "network" ? "на сайтах-партнёрах" : "в поиске");
  const ad = (id: string) => (adTitles.has(id) ? `объявление «${adTitles.get(id) ?? ""}»` : "объявление");
  switch (action.type) {
    case "SetDeviceAdjustment": {
      const device = action.device === "mobile" ? "с телефонов" : "с компьютеров";
      if (action.percent === 0) return `Убрал поправку цены перехода ${device}`;
      return `${action.percent > 0 ? "Поднял" : "Снизил"} цену перехода ${device} на ${Math.abs(action.percent)}%`;
    }
    case "SetSpendLimit": {
      const before = Number(c.before.weeklyLimit);
      const after = Number(c.after.weeklyLimit);
      if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
      return after >= before
        ? `Добавил денег рекламе ${where(action.directionId)}: до ${formatRub(after)} в неделю`
        : `Уменьшил недельный лимит рекламы ${where(action.directionId)} до ${formatRub(after)}`;
    }
    case "PauseAd":
      return `Отключил ${ad(action.adId)}`;
    case "ResumeAd":
      return `Снова включил ${ad(action.adId)}`;
    case "PauseDirection":
      return `Поставил на паузу рекламу ${where(action.directionId)}`;
    case "ResumeDirection":
      return `Снова запустил рекламу ${where(action.directionId)}`;
    case "StartExperiment":
      return action.variant ? `Запустил проверку нового варианта «${action.variant.title}»` : "Запустил проверку нового варианта объявления";
    case "FinishExperiment":
      return `Закончил проверку и оставил ${ad(action.keepAdId)}`;
    case "AddNegativeKeywords":
      return `Убрал показы по запросам ${quoted(action.phrases)}`;
    case "RemoveNegativeKeywords":
      return `Вернул показы по запросам ${quoted(action.phrases)}`;
    case "UpdateAdText":
      return `Переписал ${ad(action.adId)}`;
    default:
      return null;
  }
};

const empty = (): PerformanceStats => ({ impressions: 0, clicks: 0, leads: 0, spend: 0 });
const add = (a: PerformanceStats, r: DailyStatRow): PerformanceStats => ({ impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks, leads: a.leads + r.leads, spend: a.spend + r.spend });

/** Pure: the ads people see now, the agent's journal of the run oldest first in sections of the lived weeks, the week brief. */
export const buildServiceWork = (input: ServiceWorkInput): ServiceWorkModel => {
  const directions = new Map(input.directions.map((d) => [d.id, d]));
  const adTitles = new Map(input.ads.map((a) => [a.id, a.title]));
  const decisions = input.changes.filter((c) => c.status === "applied" && c.author === "service" && !isBudgetAdjustment(c));
  const byInsight = new Map<string, ChangeEntry[]>();
  for (const c of decisions) if (c.insightId) byInsight.set(c.insightId, [...(byInsight.get(c.insightId) ?? []), c]);

  const reverted = new Map<string, HistoryItem>();
  for (const item of input.history) if (item.insight) reverted.set(item.insight.id, item);
  const historyById = new Map(input.history.map((h) => [h.id, h]));
  const changesOf = (card: InsightCardModel): JournalChange[] => {
    if (card.decision.status !== "applied" && card.decision.status !== "clamped") return [];
    const entries = byInsight.get(card.id) ?? [];
    if (entries.length === 0) {
      const item = reverted.get(card.id) ?? card.rollback;
      return [{ text: card.decision.text, reverted: item?.reverted ?? false, historyId: item?.id ?? null, item, facts: card.facts, turnId: item?.turnId ?? null }];
    }
    return entries.map((c) => {
      const item = historyById.get(c.id) ?? null;
      return { text: changeHeadline(c, directions, adTitles) ?? card.decision.text, reverted: item?.reverted ?? c.revertedById !== null, historyId: c.id, item, facts: card.facts, turnId: c.turnId };
    });
  };
  const dayOf = (date: LocalDate) => daysBetween(input.startedOn, date) + 1;
  /** With changes the changes are the gist; otherwise the first sentence is, and the rest is the text. */
  const gist = (paragraphs: string[], changes: JournalChange[]): { headline: string | null; paragraphs: string[] } => {
    if (changes.length > 0 || paragraphs.length === 0) return { headline: null, paragraphs };
    const [first, rest] = firstSentence(paragraphs[0] ?? "");
    return { headline: first, paragraphs: [rest, ...paragraphs.slice(1)].filter((p) => p.length > 0) };
  };

  // Hypotheses are said once: when they are opened and when they are closed, not again every Monday.
  const told = new Set<string>();
  const entries: JournalEntry[] = [];
  for (const review of [...input.reviews].reverse()) {
    const base = { date: review.date, from: review.from, day: dayOf(review.date) };
    const truthsOf = (cards: InsightCardModel[]) => cards.flatMap((i) => (i.truth && changesOf(i).length > 0 ? [i.truth] : []));
    if (review.weekly) {
      const w = review.weekly;
      const checking = w.checking.filter((h) => !told.has(`open:${h.id}`));
      const found = w.found.filter((h) => h.outcome !== null && !told.has(`closed:${h.id}`));
      checking.forEach((h) => told.add(`open:${h.id}`));
      found.forEach((h) => told.add(`closed:${h.id}`));
      const changes = w.insights.flatMap(changesOf);
      const paragraphs = w.summary ? speech(w.summary) : w.insights.map((i) => withStop(i.observation));
      if (paragraphs.length > 0 || checking.length > 0 || found.length > 0) {
        entries.push({
          ...base, id: `${review.date}:week`, kind: "agent", weekly: true, ...gist(paragraphs, changes), changes,
          checking: checking.map((h) => ({ statement: h.statement, checkOn: h.checkOn })),
          found: found.map((h) => ({ statement: h.statement, outcome: h.outcome ?? "", result: h.result })),
          truths: truthsOf(w.insights),
          objectIds: [...new Set(w.insights.flatMap((i) => i.objectIds))],
        });
      }
    }
    const agent = review.insights.filter((i) => i.author === "agent");
    const rules = review.insights.filter((i) => i.author === "rule");
    const none = { checking: [], found: [] };
    if (review.summary !== null || agent.length > 0) {
      const changes = agent.flatMap(changesOf);
      const paragraphs = review.summary !== null ? speech(review.summary) : agent.map((i) => withStop(i.observation));
      entries.push({
        ...base, ...none, id: `${review.date}:day`, kind: "agent", weekly: false, ...gist(paragraphs, changes), changes,
        truths: truthsOf(agent),
        objectIds: [...new Set(agent.flatMap((i) => i.objectIds))],
      });
    }
    if (rules.length > 0) {
      const changes = rules.flatMap(changesOf);
      const paragraphs = [...(review.rulesReason ? [withStop(review.rulesReason)] : []), ...rules.map((i) => withStop(i.observation))];
      entries.push({
        ...base, ...none, id: `${review.date}:rules`, kind: "rules", weekly: false, ...gist(paragraphs, changes), changes,
        truths: truthsOf(rules),
        objectIds: [...new Set(rules.flatMap((i) => i.objectIds))],
      });
    } else if (review.rulesReason !== null && review.summary === null && agent.length === 0) {
      entries.push({ ...base, ...none, id: `${review.date}:rules`, kind: "quiet", weekly: false, headline: null, paragraphs: [withStop(review.rulesReason)], changes: [], truths: [], objectIds: [] });
    } else if (review.quiet && review.summary === null && agent.length === 0 && !review.weekly) {
      entries.push({ ...base, ...none, id: `${review.date}:quiet`, kind: "quiet", weekly: false, headline: null, paragraphs: [review.from ? `${QUIET_DAYS[0]?.toUpperCase() ?? ""}${QUIET_DAYS.slice(1)}.` : `${QUIET_DAY}.`], changes: [], truths: [], objectIds: [] });
    }
  }

  // The rest of the history (change-history spec): the owner's and the cabinet's changes, the launch and the budget guard's
  // records other than its limit cuts, which the budget line covers. Decisions with an insight are already told above.
  const inJournal = new Set(entries.flatMap((e) => e.changes.map((c) => c.historyId)));
  for (const item of input.history) {
    if (item.status !== "applied" || item.budgetAdjustment || inJournal.has(item.id) || (item.author === "service" && item.insight !== null)) continue;
    const date = toLocalDate(new Date(item.at), input.timeZone);
    const who = item.author === "user" ? "Вы" : item.author === "cabinet" ? "В кабинете Директа" : null;
    // «Отключили объявление» names its ad: «Вы: отключили объявление «Маникюр у метро»».
    const action = item.decisionText ? lowerFirst(item.decisionText).replace(/объявление$/, lowerFirst(item.object)) : null;
    const what = item.reasonCode === "LAUNCH" ? "реклама запущена" : action ?? `${item.object} — ${item.diff.map((d) => `${d.label.toLowerCase()}: было ${d.before} → стало ${d.after}`).join("; ")}`;
    entries.push({
      id: `h:${item.id}`, date, from: null, day: dayOf(date), kind: item.author === "service" ? "rules" : "owner", weekly: false, headline: null,
      paragraphs: item.author === "service" ? [withStop(item.explanation)] : [],
      changes: [{ text: who ? `${who}: ${what}` : sentenceCase(what), reverted: item.reverted, historyId: item.id, item, facts: [], turnId: null }],
      checking: [], found: [], truths: [], objectIds: [],
    });
  }
  // Oldest first; a day's own records keep their order (reviews, then the history of that day).
  entries.sort((a, b) => a.date.localeCompare(b.date));

  // The mornings after a week's days, up to the one it ended on; the launch day belongs to the first week.
  const weekOf = (date: LocalDate) => input.weeks.find((w) => date >= (w.week === 1 ? input.startedOn : addDays(w.from, 1)) && date <= w.reviewedOn);
  const journal: JournalSection[] = [];
  for (const entry of entries) {
    const week = weekOf(entry.date);
    const last = journal.at(-1);
    if (last && last.week === (week?.week ?? null) && (week !== undefined || last.to >= addDays(entry.from ?? entry.date, -1))) {
      last.entries.push(entry);
      last.to = entry.date;
      continue;
    }
    journal.push({ week: week?.week ?? null, from: week?.from ?? entry.from ?? entry.date, to: entry.date, entries: [entry] });
  }
  for (const section of journal) {
    const week = input.weeks.find((w) => w.week === section.week);
    if (week) section.to = week.reviewedOn > week.from ? addDays(week.reviewedOn, -1) : week.from;
  }

  // Which journal record tells each change, for the marks on the ads.
  const entryOf = new Map<string, string>();
  for (const s of journal) for (const e of s.entries) for (const c of e.changes) if (c.historyId) entryOf.set(c.historyId, e.id);
  const markOf = (c: ChangeEntry): ChangeMark | null => {
    const text = changeHeadline(c, directions, adTitles);
    return text === null ? null : { text, date: toLocalDate(c.createdAt, input.timeZone), entryId: entryOf.get(c.id) ?? null };
  };
  const newest = [...decisions].filter((c) => c.revertedById === null).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const adOf = (c: ChangeEntry): string | null => ("adId" in c.action ? c.action.adId : c.action.type === "FinishExperiment" ? c.action.keepAdId : null);

  const since7 = addDays(input.today, -7);
  const since14 = addDays(input.today, -14);
  const order: Record<EffectivenessClass, number> = { effective: 0, borderline: 1, learning: 2, ineffective: 3 };
  const shown: ShownAd[] = input.ads
    .filter((ad) => ad.status === "active" && ad.moderation !== "rejected" && directions.get(ad.directionId)?.status === "active")
    .map((ad) => {
      const own = input.stats.filter((r) => r.adId === ad.platformAdId && r.date < input.today);
      const week = own.filter((r) => r.date >= since7).reduce(add, empty());
      const change = newest.find((c) => adOf(c) === ad.id);
      return {
        id: ad.id,
        directionId: ad.directionId,
        title: ad.title,
        text: ad.text,
        channel: directions.get(ad.directionId)?.channel ?? "search",
        verdict: classify(own.filter((r) => r.date >= since14).reduce(add, empty()), daysBetween(ad.createdOn, input.today), input.cso),
        fresh: ad.createdOn > input.startedOn && ad.createdOn > since7,
        pending: ad.moderation === "pending",
        checking: (input.checkAds ?? []).some((v) => v.title === ad.title && v.text === ad.text),
        clicks: week.clicks,
        leads: week.leads,
        change: change ? markOf(change) : null,
      };
    })
    .sort((a, b) => order[a.verdict] - order[b.verdict] || b.leads - a.leads || b.clicks - a.clicks);
  const shownIds = new Set(shown.map((a) => a.id));
  const hidden = input.ads.filter((ad) => !shownIds.has(ad.id)).map((ad) => ({ id: ad.id, title: ad.title, paused: ad.status !== "active" }));
  const directionChanges = input.directions
    .filter((d) => d.status === "active")
    .flatMap((d) => {
      const change = newest.find((c) => c.objectKind === "direction" && c.objectId === d.id && adOf(c) === null);
      const mark = change ? markOf(change) : null;
      return mark ? [{ ...mark, channel: d.channel }] : [];
    });

  let brief: WeekBrief | null = null;
  const lastWeek = input.weeks.at(-1);
  if (lastWeek) {
    const section = journal.find((s) => s.week === lastWeek.week);
    const to = lastWeek.reviewedOn > lastWeek.from ? addDays(lastWeek.reviewedOn, -1) : lastWeek.from;
    const totals = input.stats.filter((r) => r.date >= lastWeek.from && r.date <= to).reduce(add, empty());
    brief = {
      week: lastWeek.week,
      from: lastWeek.from,
      to,
      changes: (section?.entries ?? []).flatMap((e) => e.changes.filter((c) => !c.reverted).map((c) => c.text)),
      checks: { count: input.openChecks.length, nextOn: input.openChecks.map((h) => h.checkOn).sort()[0] ?? null },
      leads: totals.leads,
      spend: totals.spend,
      costPerLead: costPerLead(totals),
      goal: input.cso,
    };
  }
  return { shown, hidden, directionChanges, journal, brief };
};
