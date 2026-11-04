import { addDays, daysBetween } from "@impuls/core";
import type { Kopecks, LocalDate } from "@impuls/core";
import { calendarWords } from "./day-words";
import type { DayWords } from "./day-words";
import { formatRub, plural } from "./format";
import type { InsightFeedModel } from "./insights-model";

import type { MeasurementModel } from "./measurement";

export type SummaryPeriod = "week" | "month";

export interface Compared<T> {
  value: T;
  previous: T;
}

export interface SummaryModel {
  measurement?: MeasurementModel;
  dataPeriod?: { from: string; to: string; asOf: string; month: string; previousPartial?: boolean };
  daily?: { date: string; leads: number | null; spend: number; decision: boolean }[];
  timeZone: string;
  period: SummaryPeriod;
  /** first_day: no statistics yet, show the launch state instead of zeros. */
  state: "first_day" | "running" | "paused";
  /** A business in the simulation mode: no Yandex moderation or data corrections, real seconds per virtual day. */
  /** A simulated business: how many weeks have been lived, for «Прожить первую неделю». */
  simulation: { weeks: number } | null;
  /** Whole days since the launch, today included. */
  launchedDays: number;
  /** False in the first period after launch: the previous one was entirely before it (analytics spec). */
  compare: boolean;
  /** The launch month is not a full one: its prorated budget and the full one from the next month. */
  launchMonth: { budget: Kopecks; monthName: string; nextMonthName: string } | null;
  monthlyBudget: Kopecks;
  moderation: { pending: number; accepted: number; rejected: number };
  monthBudget: Kopecks;
  spentMonth: Kopecks;
  /** What an even pace would have spent of the month budget by the data date: the «план» mark on the budget bar. */
  budgetPlan: Kopecks;
  /** From 80% of the month budget: what is left and when it runs out at the last 7 days' pace (budget-guard spec). */
  budgetForecast: { left: Kopecks; exhaustOn: string | null } | null;
  spend: Compared<Kopecks>;
  leads: Compared<number>;
  clients: Compared<number | null>;
  clientCost:
    | { kind: "known"; costPerClient: Kopecks | null; clients: number; week: string }
    | { kind: "unknown"; costPerLead: Kopecks | null; hint: string; week: string };
  /** `learned`: the automatic goal is already refined from the business's own leads (optimization-engine). */
  goal: { mode: "user" | "auto"; cso: Kopecks; learned: boolean; current: Kopecks | null; status: "within" | "above" | "no_data" };
  /** Insights of the period with the day reviews, the running check first (insights spec). */
  feed: InsightFeedModel;
  /** The service has made a decision about the ads: a simulation stops offering to skip to the first one. */
  decided: boolean;
  attention: {
    notifications: { id: string; kind: string; message: string; at: string }[];
    clientsQuestion: { week: string; weekEnd: string; leads: number } | null;
  };
  directions: {
    id: string;
    name: string;
    channel: "search" | "network";
    status: "active" | "paused";
    ads: number;
    weeklyLimit: Kopecks;
    spend: Kopecks;
    leads: number;
    costPerLead: Kopecks | null;
  }[];
}

export const BUDGET_FORECAST_SHARE = 0.8;

/** Left money and the day it runs out at the average daily spend of the last 7 days; shown from 80% spent. */
export const budgetForecast = (monthBudget: Kopecks, spentMonth: Kopecks, spendLast7: Kopecks, today: LocalDate): SummaryModel["budgetForecast"] => {
  if (monthBudget === 0 || spentMonth < monthBudget * BUDGET_FORECAST_SHARE) {
    return null;
  }
  const left = Math.max(0, monthBudget - spentMonth);
  const perDay = spendLast7 / 7;
  return { left, exhaustOn: perDay <= 0 ? null : addDays(today, Math.ceil(left / perDay)) };
};

/**
 * An even pace through the budget period: the month, or from the launch day in the month of the launch, as the prorated
 * budget is. The data date counts as spent.
 */
export const budgetPlan = (monthBudget: Kopecks, periodStart: LocalDate, periodEnd: LocalDate, date: LocalDate): Kopecks => {
  const days = daysBetween(periodStart, periodEnd) + 1;
  const passed = Math.min(days, Math.max(0, daysBetween(periodStart, date) + 1));
  return days <= 0 ? 0 : Math.round((monthBudget * passed) / days);
};

/** The state line over the answer (analytics spec «Сводка»): running, paused, Yandex reviewing, or nothing shown. */
export type AdsState = { kind: "running"; shown: number } | { kind: "paused" } | { kind: "review" } | { kind: "idle" };

export const adsState = (input: { state: SummaryModel["state"]; simulation: boolean; moderationPending: number; shown: number }): AdsState => {
  if (input.state === "paused") return { kind: "paused" };
  if (input.shown > 0) return { kind: "running", shown: input.shown };
  // Yandex reviews ads only in the Direct mode; a simulated market has no moderation queue to wait for.
  if (!input.simulation && input.moderationPending > 0) return { kind: "review" };
  return { kind: "idle" };
};

export const adsStateText = (state: AdsState): string => {
  switch (state.kind) {
    case "running":
      return `идёт · ${state.shown} ${plural(state.shown, "объявление", "объявления", "объявлений")}`;
    case "paused":
      return "на паузе";
    case "review":
      return "на проверке Яндекса";
    case "idle":
      return "объявления не показываются";
  }
};

/** The green mark by a goal the price meets: none for a reference, a price above the goal or no leads yet. */
export const goalBadge = (goal: SummaryModel["goal"]): string | null => {
  if (!goalComparable(goal) || goal.current === null || goal.cso <= 0 || goal.current > goal.cso) return null;
  const cheaper = Math.floor(((goal.cso - goal.current) / goal.cso) * 100);
  return cheaper >= 5 ? `дешевле цели на ${cheaper}%` : "в цели";
};

/**
 * «Дальше» on the main screen (analytics spec «Сводка»): the nearest open check with its day, or the next morning's look,
 * which the daily evaluation makes with or without the agent. «Проверяю, останется ли …» → «16 ноября сервис проверит, останется ли …».
 */
export const nextStepText = (next: { statement: string; checkOn: LocalDate; more: number } | null, today: LocalDate, words: DayWords = calendarWords): string => {
  if (next === null) return "завтра утром сервис снова посмотрит рекламу";
  const when = next.checkOn < today ? "скоро" : next.checkOn === today ? "сегодня" : next.checkOn === addDays(today, 1) ? "завтра" : words.on(next.checkOn);
  const statement = words.text(next.statement.trim().replace(/[.…]+$/, ""));
  const asked = /^провер(?:яю|ю|яем|им)\s*[,:—-]?\s*/i.exec(statement);
  const lowered = `${statement[0]?.toLowerCase() ?? ""}${statement.slice(1)}`;
  const text = asked ? `${when} сервис проверит, ${statement.slice(asked[0].length)}` : `${when} — итог проверки: ${lowered}`;
  return next.more > 0 ? `${text} · ещё ${next.more} ${plural(next.more, "проверка", "проверки", "проверок")}` : text;
};

/** The goal's explanation behind its words (analytics spec «Сводка»): where the number comes from and when it is refined. */
export const goalExplanation = (goal: Pick<SummaryModel["goal"], "mode" | "learned">): string => {
  if (goal.mode === "user") return "Эту цель вы задали сами: сервис старается, чтобы обращение стоило не дороже. Изменить её можно в настройках.";
  if (goal.learned) return "Цель рассчитана по вашим обращениям за последние 30 дней: сервис старается, чтобы обращение стоило не дороже.";
  return "Пока это ориентир: бюджет месяца, делённый на 30. Когда за 30 дней наберётся 20 обращений, сервис рассчитает цель по вашим данным.";
};

/** Whether the goal line compares with a goal: never with the starting value of the automatic goal. */
export const goalComparable = (goal: SummaryModel["goal"]): boolean => goal.mode === "user" || goal.learned;

/** «Цель: до M ₽ за обращение · Сейчас: X ₽ — дороже цели» (analytics spec). */
export const goalLine = (goal: SummaryModel["goal"]): string => {
  if (!goalComparable(goal)) {
    return `Цену обращения подбираем сами по вашим результатам · Сейчас: ${goal.current === null ? "обращений пока нет" : `${formatRub(goal.current)} за обращение`}`;
  }
  const target = goal.mode === "user" ? `Цель: до ${formatRub(goal.cso)} за обращение` : `Цель: подбираем сами, сейчас до ${formatRub(goal.cso)} за обращение`;
  if (goal.current === null) {
    return `${target} · Сейчас: обращений пока нет`;
  }
  return `${target} · Сейчас: ${formatRub(goal.current)} — ${goal.status === "within" ? "в цели" : "дороже цели"}`;
};

/** The goal under the cost per lead in its tile: «Цель: до 300 ₽», or «Цену подбираем сами» while it is being refined. */
export const goalTileText = (goal: SummaryModel["goal"]): string => {
  if (goal.mode === "user") return `Цель: до ${formatRub(goal.cso)}`;
  return goal.learned ? `Цель: подбираем сами, сейчас до ${formatRub(goal.cso)}` : "Цену подбираем сами по вашим результатам";
};

/** Comparison with the previous period in plain words. */
export const compareText = (value: number, previous: number, format: (n: number) => string): string => {
  if (value === previous) {
    return "как в прошлом периоде";
  }
  const diff = value - previous;
  return `${diff > 0 ? "больше" : "меньше"} на ${format(Math.abs(diff))}, чем в прошлом периоде`;
};

export const channelLabel = (channel: "search" | "network"): string => (channel === "search" ? "Поиск Яндекса" : "Сайты-партнёры Яндекса");

/** «С запуска · 3 дня» while the launch is inside the selected period, so there is nothing to compare with. */
export const periodLead = (model: Pick<SummaryModel, "period" | "launchedDays" | "compare">): string => {
  if (!model.compare) return `С запуска · ${model.launchedDays} ${plural(model.launchedDays, "день", "дня", "дней")}`;
  return model.period === "week" ? "Последние 7 дней" : "Текущий месяц";
};

/** «До конца октября — 967 ₽, с 1 ноября — 15 000 ₽ в месяц» (analytics spec). */
export const launchMonthText = (model: Pick<SummaryModel, "launchMonth" | "monthlyBudget">): string | null =>
  model.launchMonth === null
    ? null
    : `До конца ${model.launchMonth.monthName} — ${formatRub(model.launchMonth.budget)}, с 1 ${model.launchMonth.nextMonthName} — ${formatRub(model.monthlyBudget)} в месяц`;

export const moderationText = (m: SummaryModel["moderation"]): string => {
  if (m.pending > 0) {
    return "Яндекс проверяет объявления, обычно это занимает несколько часов";
  }
  if (m.rejected > 0 && m.accepted === 0) {
    return "Яндекс не пропустил объявления — мы готовим исправленные варианты";
  }
  return "Объявления прошли проверку Яндекса";
};

/** Keep gaps distinct from reported zero leads; use only the selected observed rows. */
export const observedDaily = (from: LocalDate, to: LocalDate, rows: readonly { date: LocalDate; leads: number; spend: number }[], decisionDates: ReadonlySet<LocalDate>): NonNullable<SummaryModel["daily"]> => {
  const totals = new Map<LocalDate, { leads: number; spend: number }>();
  for (const row of rows) {
    const current = totals.get(row.date) ?? { leads: 0, spend: 0 };
    totals.set(row.date, { leads: current.leads + row.leads, spend: current.spend + row.spend });
  }
  const days: NonNullable<SummaryModel["daily"]> = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const total = totals.get(date);
    days.push({ date, leads: total?.leads ?? null, spend: total?.spend ?? 0, decision: decisionDates.has(date) });
  }
  return days;
};
