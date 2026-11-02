import { addDays, daysInMonth, phraseMatches, rubles } from "@impuls/core";
import type { Channel, LocalDate } from "@impuls/core";
import type { AdTruth } from "@impuls/platforms";
import type { LaunchPlan } from "./launch";

export const SCENARIO_IDS = ["regular", "dead_ad", "borderline", "month_end", "cabinet_edit"] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

/** A day of the scenario on which something happens outside the service. */
export type ScenarioEvent = { day: number; kind: "cabinet_pause_campaign"; channel: Channel };

/** What a scenario is made to show on the checklist (simulation-mode spec «Чек-лист критериев»). */
export type ScenarioShowKey = "pause" | "scale" | "experiment" | "cabinet";

/** A checklist item the scenario shows and the day by which it is usually seen. */
export interface ScenarioPromise {
  key: ScenarioShowKey;
  byDay: number;
}

/**
 * A market the simulation mode runs in (simulation-mode spec «Сценарии рынка»): hidden truth of every ad by its place
 * in the launch plan, the truth of an A/B variant, events by day and what the scenario needs from the plan.
 */
export interface Scenario {
  id: ScenarioId;
  title: string;
  /** What happens, in the owner's words. */
  description: string;
  /** Offered first on step 6; the others are under «Другие сценарии». */
  recommended: boolean;
  /** What the checklist expects from this scenario; other items appear only once done. */
  shows: ScenarioPromise[];
  seed: number;
  /** Truth of the ads of each channel in launch order; the last one repeats for extra ads. */
  truths: Record<Channel, AdTruth[]>;
  /** Truth of every ad created after launch: the new variant of an A/B check. */
  variantTruth: AdTruth;
  minAds: Record<Channel, number>;
  minBudgetRub: number;
  /** Virtual launch this many days before the end of the month instead of now. */
  daysBeforeMonthEnd: number | null;
  events: ScenarioEvent[];
  /**
   * Search queries and devices of the search ads (add-agent-analyst-stage1): the direction's own phrases, junk queries
   * made of its first phrase and a word, and the device split. Without settings the stats stay as without them.
   */
  segments?: ScenarioSegments;
}

export interface ScenarioSegments {
  /**
   * Words that make a junk query of the first own phrase («маникюр фото»), in order of preference: the first
   * `junkQueries` of them the plan's negative phrases do not already cut.
   */
  junkWords: string[];
  junkQueries: number;
  /** Share of the search traffic that comes from the junk queries; they never bring a client. */
  junkShare: number;
  devices: NonNullable<AdTruth["devices"]>;
}

// Search: a few hundred people a day see the ad; partner sites: thousands, but few click.
const good: AdTruth = { impressionsPerDay: 700, ctr: 0.06, cr: 0.09, costPerClick: rubles(18) };
const medium: AdTruth = { impressionsPerDay: 600, ctr: 0.05, cr: 0.05, costPerClick: rubles(20) };
const weak: AdTruth = { impressionsPerDay: 600, ctr: 0.05, cr: 0.008, costPerClick: rubles(20) };
const dead: AdTruth = { impressionsPerDay: 1_500, ctr: 0.08, cr: 0, costPerClick: rubles(30) };
const borderline: AdTruth = { impressionsPerDay: 2_500, ctr: 0.06, cr: 0.015, costPerClick: rubles(8) };
/** Partner sites at about the search price, so the borderline check is not decided by a cheap other channel. */
const networkEven: AdTruth = { impressionsPerDay: 8_000, ctr: 0.008, cr: 0.025, costPerClick: rubles(9) };
const networkGood: AdTruth = { impressionsPerDay: 8_000, ctr: 0.008, cr: 0.05, costPerClick: rubles(9) };
const networkWeak: AdTruth = { impressionsPerDay: 8_000, ctr: 0.006, cr: 0.006, costPerClick: rubles(10) };
const betterVariant: AdTruth = { impressionsPerDay: 2_500, ctr: 0.065, cr: 0.05, costPerClick: rubles(8) };

const RECOMMENDED_BUDGET_RUB = 10_000;

/**
 * People look at photos and ideas or read forums and do not book; phones bring clients several times dearer than
 * computers. The usual negative phrases of a plan («бесплатно», «обучение») do not cover these words.
 */
const JUNK_AND_DEAR_PHONES: ScenarioSegments = {
  junkWords: ["фото", "идеи", "форум", "отзывы"],
  junkQueries: 2,
  junkShare: 0.3,
  devices: { mobile: { share: 0.6, crFactor: 0.25 }, desktop: { share: 0.35, crFactor: 1.7 }, tablet: { share: 0.05 } },
};

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  regular: {
    id: "regular",
    title: "Обычный месяц",
    description: "Объявления работают по-разному: есть хорошие и слабые. Сервис добавляет денег тому, что приводит клиентов.",
    recommended: true,
    shows: [{ key: "scale", byDay: 15 }],
    seed: 101,
    truths: { search: [good, medium, weak], network: [networkGood, networkWeak] },
    variantTruth: betterVariant,
    minAds: { search: 1, network: 0 },
    minBudgetRub: RECOMMENDED_BUDGET_RUB,
    daysBeforeMonthEnd: null,
    events: [],
    segments: JUNK_AND_DEAR_PHONES,
  },
  dead_ad: {
    id: "dead_ad",
    title: "Одно объявление не приносит клиентов",
    description: "Первое объявление в поиске охотно открывают, но никто не записывается. Сервис должен заметить это и отключить его.",
    recommended: false,
    shows: [
      { key: "pause", byDay: 14 },
      { key: "scale", byDay: 10 },
    ],
    seed: 202,
    truths: { search: [dead, good], network: [networkGood] },
    variantTruth: betterVariant,
    minAds: { search: 2, network: 0 },
    minBudgetRub: RECOMMENDED_BUDGET_RUB,
    daysBeforeMonthEnd: null,
    events: [],
  },
  borderline: {
    id: "borderline",
    title: "Пограничное объявление",
    description: "Объявление в поиске работает «так себе». Сервис проверит новый вариант и оставит тот, что приводит клиентов дешевле.",
    recommended: false,
    shows: [{ key: "experiment", byDay: 30 }],
    seed: 303,
    truths: { search: [borderline, good], network: [networkEven] },
    variantTruth: betterVariant,
    minAds: { search: 1, network: 0 },
    minBudgetRub: RECOMMENDED_BUDGET_RUB,
    daysBeforeMonthEnd: null,
    events: [],
  },
  month_end: {
    id: "month_end",
    title: "Конец месяца",
    description: "Реклама запускается за 4 дня до конца месяца: в первый месяц сервис тратит только часть бюджета, с 1-го — полный.",
    recommended: false,
    shows: [{ key: "scale", byDay: 12 }],
    seed: 404,
    truths: { search: [good, medium, weak], network: [networkGood, networkWeak] },
    variantTruth: betterVariant,
    minAds: { search: 1, network: 0 },
    minBudgetRub: RECOMMENDED_BUDGET_RUB,
    daysBeforeMonthEnd: 4,
    events: [],
  },
  cabinet_edit: {
    id: "cabinet_edit",
    title: "Правка в кабинете",
    description: "На 5-й день кто-то вручную ставит рекламу в поиске на паузу в кабинете Директа. Сервис покажет это в истории, и правку можно вернуть.",
    recommended: false,
    shows: [
      { key: "cabinet", byDay: 5 },
      { key: "scale", byDay: 10 },
    ],
    seed: 505,
    truths: { search: [good, medium], network: [networkGood] },
    variantTruth: betterVariant,
    minAds: { search: 1, network: 0 },
    minBudgetRub: RECOMMENDED_BUDGET_RUB,
    daysBeforeMonthEnd: null,
    events: [{ day: 5, kind: "cabinet_pause_campaign", channel: "search" }],
  },
};

/**
 * Local date of the virtual launch (simulation-mode spec «Сценарии рынка»): the 1st of the next month, so the simulated
 * month is a calendar month with the full budget; «Конец месяца» starts that many days before a month ends, never in
 * the past. The launch plan's weekly limits are computed for this date, not for the real one.
 */
export const scenarioStartDate = (scenario: Scenario, today: LocalDate): LocalDate => {
  const nextMonth = addDays(today, daysInMonth(today) - Number(today.slice(8, 10)) + 1);
  if (scenario.daysBeforeMonthEnd === null) {
    return nextMonth;
  }
  const target = addDays(today, daysInMonth(today) - Number(today.slice(8, 10)) - scenario.daysBeforeMonthEnd + 1);
  return target < today ? addDays(nextMonth, daysInMonth(nextMonth) - scenario.daysBeforeMonthEnd) : target;
};

/** The scenario step 6 selects in advance. */
export const RECOMMENDED_SCENARIO: ScenarioId = "regular";

export const isScenarioId = (value: string): value is ScenarioId => (SCENARIO_IDS as readonly string[]).includes(value);

const CHANNEL_WORDS: Record<Channel, string> = { search: "в поиске", network: "на сайтах-партнёрах" };

/**
 * Why the scenario cannot run with this plan and budget, in the owner's words, or null when it can
 * (simulation-mode spec: «Сценарию не хватает объявлений»).
 */
export const scenarioUnavailable = (scenario: Scenario, ads: Record<Channel, number>, monthlyBudgetRub: number): string | null => {
  for (const channel of ["search", "network"] as const) {
    const need = scenario.minAds[channel];
    if (ads[channel] < need) {
      return `Нужно хотя бы ${need} ${need === 1 ? "объявление" : "объявления"} ${CHANNEL_WORDS[channel]} — сейчас ${ads[channel]}`;
    }
  }
  if (monthlyBudgetRub < scenario.minBudgetRub) {
    return `Нужен бюджет от ${scenario.minBudgetRub.toLocaleString("ru-RU")} ₽ в месяц, иначе за 30 дней сервису не хватит данных для решений`;
  }
  return null;
};

/** Own phrases of a search ad that get their own queries in the truth; the rest of the plan's phrases share theirs. */
const OWN_QUERIES = 5;

/**
 * Truth of the n-th ad of a channel in the launch plan; a search ad gets the scenario's queries of its direction's
 * `keywords`, with junk the direction's `negativeKeywords` do not cut yet.
 */
export const launchTruth = (
  scenario: Scenario,
  channel: Channel,
  index: number,
  direction: { keywords: readonly string[]; negativeKeywords: readonly string[] } = { keywords: [], negativeKeywords: [] },
): AdTruth => {
  const list = scenario.truths[channel];
  const truth = list[Math.min(index, list.length - 1)];
  if (truth === undefined) {
    throw new Error(`Scenario ${scenario.id} has no truth for ${channel}`);
  }
  const segments = scenario.segments;
  const own = direction.keywords.slice(0, OWN_QUERIES);
  const first = own[0];
  if (channel !== "search" || segments === undefined || first === undefined) {
    return truth;
  }
  const junk = segments.junkWords
    .map((word) => `${first} ${word}`)
    .filter((query) => !direction.negativeKeywords.some((phrase) => phraseMatches(phrase, query)))
    .slice(0, segments.junkQueries);
  return {
    ...truth,
    queries: [
      ...own.map((text) => ({ text, share: (junk.length === 0 ? 1 : 1 - segments.junkShare) / own.length, crFactor: 1 })),
      ...junk.map((text) => ({ text, share: segments.junkShare / junk.length, crFactor: 0 })),
    ],
    devices: segments.devices,
  };
};

/** Ads per channel in a launch plan, for `scenarioUnavailable`. */
export const planAds = (plan: LaunchPlan): Record<Channel, number> => ({
  search: plan.directions.filter((d) => d.channel === "search").reduce((n, d) => n + d.ads.length, 0),
  network: plan.directions.filter((d) => d.channel === "network").reduce((n, d) => n + d.ads.length, 0),
});
