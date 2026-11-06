import { addDays, phraseMatches, phraseWords, toLocalDate } from "@impuls/core";
import type { Channel, Kopecks, LocalDate } from "@impuls/core";
import type { DeviceAdjustments, SimulatorState } from "@impuls/platforms";
// The browser-safe part of the platforms: the market's own multipliers, so the window counts as the market does.
import { adjustmentOf, allocate, DEFAULT_DEVICES, DEVICES, impressionMultiplier, priceMultiplier } from "@impuls/platforms/segments";
import type { PeriodSegments, SegmentRow } from "@impuls/platforms/segments";

/**
 * A period of stats the owner enters in a simulation (simulation-mode spec «Статистика периода от владельца»). Pure and
 * free of the platform adapters, so the window checks itself in the browser with the same rules the web and the worker
 * check again.
 */

export const PERIOD_DAYS = [1, 3, 7, 14] as const;
export type PeriodDays = (typeof PERIOD_DAYS)[number];

/** What the owner entered for one ad; money in whole rubles. */
export interface PeriodAdInput {
  adId: string;
  impressions: number;
  clicks: number;
  leads: number;
  spendRub: number;
}

/**
 * What else happened in a period (simulation-breakdowns): how the entered numbers split inside, never the numbers
 * themselves. Without marks the split is even.
 */
export interface PeriodMarket {
  /** «Часть денег ушла на ненужный запрос»: a quarter of every search ad's traffic, no leads. */
  junkQuery: boolean;
  /** «С телефонов обращаются хуже»: a lead from a phone costs four times what one from a computer does. */
  phonesWorse: boolean;
}

export const NO_MARKET: PeriodMarket = { junkQuery: false, phonesWorse: false };

/**
 * A direction's key phrases (search only), negative phrases and bid adjustments, and its junk query: what the split
 * depends on. The junk query is chosen once, by the key phrases and the launch's negative phrases, so it stays the same
 * from period to period and a negative phrase added later takes it away.
 */
export interface DirectionTraffic {
  keywords: readonly string[];
  negativeKeywords: readonly string[];
  deviceAdjustments: DeviceAdjustments;
  /** «маникюр фото», or null: network ads, or no fitting word. Absent in periods saved before it was kept. */
  junkQuery?: string | null | undefined;
}

/** What the platform tells of a campaign for the window: its settings now and its negative phrases at launch. */
export interface CampaignTrafficView {
  keywords: readonly string[];
  negativeKeywords: readonly string[];
  deviceAdjustments: DeviceAdjustments;
  launchNegativeKeywords: readonly string[];
}

const NEUTRAL_ADJUSTMENTS: DeviceAdjustments = { mobile: 0, desktop: 0 };

/** An ad's numbers in the last period the owner entered for it, with that period's length, marks and settings. */
export interface PeriodAdLast {
  days: number;
  impressions: number;
  clicks: number;
  leads: number;
  spendRub: number;
  /** Absent for periods saved before simulation-breakdowns: they count as even. */
  market?: PeriodMarket;
  traffic?: DirectionTraffic;
}

export interface PeriodFormDirection extends DirectionTraffic {
  id: string;
  name: string;
  channel: Channel;
  ads: { id: string; title: string; last?: PeriodAdLast }[];
  /** What Direct would spend on the direction at most over each period from the current day, in whole rubles. */
  roomRub: Record<PeriodDays, number>;
  /** The direction's junk query («маникюр фото»), or null when it has none: network ads, no fitting word. */
  junkQuery: string | null;
}

/** The window: the ads shown now by direction, from the current day of the simulation. */
export interface PeriodForm {
  /** The current day's date: every period starts on it. */
  from: LocalDate;
  directions: PeriodFormDirection[];
  /** The marks of the last completed period: they stay until the owner takes them off. */
  market: PeriodMarket;
}

/** The marks of the last completed period, or none (simulation-mode «Статистика периода от владельца»). */
export const lastMarket = (steps: readonly { kind: string; state?: string | undefined; market?: PeriodMarket | undefined }[]): PeriodMarket => {
  const last = [...steps].reverse().find((s) => s.kind === "period" && s.state === "completed");
  return last?.market ?? NO_MARKET;
};

export type PeriodField = "impressions" | "clicks" | "leads" | "spendRub";

/** One mistake of the window, said under its field or under its direction. */
export interface PeriodError {
  adId: string | null;
  directionId: string | null;
  field: PeriodField | null;
  message: string;
}

export const ADS_CHANGED_MESSAGE = "Реклама изменилась, пока окно было открыто: проверьте объявления и лимиты";

/** A simulation starts on the 1st of the month after `today`, so its month is a calendar month with the whole budget. */
export const simulationStartDate = (today: LocalDate): LocalDate => {
  const [year = 0, month = 1] = today.split("-").map(Number);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
};

/** The dates of a period that starts at `start`. */
export const periodDates = (start: Date, days: number, timeZone: string): LocalDate[] => {
  const first = toLocalDate(start, timeZone);
  return Array.from({ length: days }, (_, i) => addDays(first, i));
};

/**
 * Ads the market shows now: active, accepted and not stopped, in an active campaign. `room` is the market's spending room
 * of a campaign on each date (`campaignRoom` of `@impuls/platforms`), `traffic` its key phrases, negative phrases and
 * adjustments now and its launch negative phrases (`campaignTraffic`): both are passed in, so this module stays free of
 * the platform adapters.
 */
export const periodForm = (input: {
  state: Pick<SimulatorState, "campaigns" | "ads">;
  room: (platformCampaignId: string, dates: readonly LocalDate[]) => Kopecks[];
  traffic: (platformCampaignId: string) => CampaignTrafficView;
  directions: readonly { id: string; name: string; channel: Channel; platformCampaignId: string }[];
  ads: readonly { id: string; title: string; directionId: string; platformAdId: string }[];
  start: Date;
  timeZone: string;
  /** The ads' last entered numbers, for «Заполнить примерно». */
  last?: ReadonlyMap<string, EnteredLast>;
  /** The marks of the last completed period. */
  market?: PeriodMarket;
}): PeriodForm => {
  const shownOnPlatform = new Set(
    input.state.ads.filter((a) => a.status === "active" && a.moderation === "accepted" && a.monitoringStopped !== true).map((a) => a.id),
  );
  const activeCampaigns = new Set(input.state.campaigns.filter((c) => c.status === "active").map((c) => c.id));
  const directions: PeriodFormDirection[] = [];
  for (const direction of input.directions) {
    if (!activeCampaigns.has(direction.platformCampaignId)) continue;
    const ads = input.ads
      .filter((a) => a.directionId === direction.id && shownOnPlatform.has(a.platformAdId))
      .map((a) => {
        const entered = input.last?.get(a.id);
        if (entered === undefined) return { id: a.id, title: a.title };
        const { traffic, ...last } = entered;
        const own = traffic?.[direction.id];
        return { id: a.id, title: a.title, last: own === undefined ? last : { ...last, traffic: own } };
      });
    if (ads.length === 0) continue;
    const room = (days: PeriodDays) =>
      Math.floor(input.room(direction.platformCampaignId, periodDates(input.start, days, input.timeZone)).reduce((s, r) => s + r, 0) / 100);
    const traffic = input.traffic(direction.platformCampaignId);
    const keywords = direction.channel === "search" ? traffic.keywords : [];
    directions.push({
      id: direction.id,
      name: direction.name,
      channel: direction.channel,
      ads,
      roomRub: { 1: room(1), 3: room(3), 7: room(7), 14: room(14) },
      keywords,
      negativeKeywords: traffic.negativeKeywords,
      deviceAdjustments: traffic.deviceAdjustments,
      junkQuery: junkQueryOf(keywords, traffic.launchNegativeKeywords),
    });
  }
  return { from: toLocalDate(input.start, input.timeZone), directions, market: input.market ?? NO_MARKET };
};

const daysWord = (n: number): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  return mod10 === 1 && mod100 !== 11 ? "день" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "дня" : "дней";
};

/** «4 200 ₽» with a no-break space between thousands, as the screens show money. */
const rub = (value: number): string => `${new Intl.NumberFormat("ru-RU").format(value).replace(/\s/g, " ")} ₽`;

/**
 * The window's checks (simulation-mode spec «Статистика периода от владельца»): numbers Direct would not send are
 * refused field by field, and an ad that is not shown any more means the advertising changed under the window.
 */
export const checkPeriod = (form: PeriodForm, days: PeriodDays, ads: readonly PeriodAdInput[]): { errors: PeriodError[]; changed: boolean } => {
  const errors: PeriodError[] = [];
  const directionOf = new Map(form.directions.flatMap((d) => d.ads.map((a) => [a.id, d] as const)));
  const changed = ads.some((a) => !directionOf.has(a.adId)) || new Set(ads.map((a) => a.adId)).size !== ads.length;
  if (changed) return { errors: [{ adId: null, directionId: null, field: null, message: ADS_CHANGED_MESSAGE }], changed };
  const at = (row: PeriodAdInput, field: PeriodField, message: string) => errors.push({ adId: row.adId, directionId: directionOf.get(row.adId)?.id ?? null, field, message });
  for (const row of ads) {
    if (row.clicks > row.impressions) at(row, "clicks", "Переходов не может быть больше, чем показов");
    if (row.leads > row.clicks) at(row, "leads", "Обращений не может быть больше, чем переходов");
    if (row.spendRub > 0 && row.clicks === 0) at(row, "spendRub", "Без переходов Директ ничего не списывает");
    if (row.clicks > 0 && row.spendRub === 0) at(row, "spendRub", "За переходы Директ списывает деньги — укажите расход");
  }
  for (const direction of form.directions) {
    const ids = new Set(direction.ads.map((a) => a.id));
    const spend = ads.filter((a) => ids.has(a.adId)).reduce((s, a) => s + a.spendRub, 0);
    const room = direction.roomRub[days];
    if (spend > room) {
      errors.push({ adId: null, directionId: direction.id, field: null, message: `Директ потратит на это направление не больше ${rub(room)} за ${days} ${daysWord(days)}` });
    }
  }
  return { errors, changed: false };
};

/** An ad's last entered numbers with the settings of every direction at that period's start, by direction id. */
export type EnteredLast = Omit<PeriodAdLast, "traffic"> & { traffic?: Readonly<Record<string, DirectionTraffic>> };

/** A completed period as the steps save it: its numbers, marks and the directions' settings at its start. */
export interface EnteredStep {
  kind: string;
  state?: string | undefined;
  days?: number | undefined;
  input?: readonly PeriodAdInput[] | undefined;
  market?: PeriodMarket | undefined;
  traffic?: Readonly<Record<string, DirectionTraffic>> | undefined;
}

/** The last non-zero numbers of every ad in the owner's completed periods, from the saved steps. */
export const lastEntered = (steps: readonly EnteredStep[]): Map<string, EnteredLast> => {
  const last = new Map<string, EnteredLast>();
  for (const step of steps) {
    if (step.kind !== "period" || step.state !== "completed" || step.days === undefined) continue;
    for (const row of step.input ?? []) {
      if (row.impressions + row.clicks + row.leads + row.spendRub === 0) continue;
      last.set(row.adId, {
        days: step.days,
        impressions: row.impressions,
        clicks: row.clicks,
        leads: row.leads,
        spendRub: row.spendRub,
        ...(step.market !== undefined && { market: step.market }),
        ...(step.traffic !== undefined && { traffic: step.traffic }),
      });
    }
  }
  return last;
};

// --- The breakdown of entered numbers (simulation-breakdowns) ---

/**
 * Words a junk query adds to a key phrase (design decision 4). Not the wizard's usual negative words («бесплатно»,
 * «вакансии», «обучение»…): those are cut from the launch on, and a junk query must be shown until the service sees it.
 */
const JUNK_WORDS = ["фото", "идеи", "отзывы", "что это"] as const;
/** Share of a search ad's showings, clicks and spend that goes to the junk query. */
export const JUNK_SHARE = 0.25;
/** A lead from a phone, against one from a computer or a tablet, when phones are worse. */
const PHONE_LEAD_FACTOR = 1 / 4;

/**
 * «маникюр фото»: the shortest key phrase with the first junk word that none of the key phrases has and none of the
 * launch's negative phrases cuts; null without one.
 */
export const junkQueryOf = (keywords: readonly string[], launchNegatives: readonly string[] = []): string | null => {
  const shortest = [...keywords].sort((a, b) => a.length - b.length)[0];
  if (shortest === undefined) return null;
  const used = new Set(keywords.flatMap(phraseWords));
  const word = JUNK_WORDS.find(
    (w) => phraseWords(w).every((part) => !used.has(part)) && !launchNegatives.some((phrase) => phraseMatches(phrase, `${shortest} ${w}`)),
  );
  return word === undefined ? null : `${shortest} ${word}`;
};

/** A segment of a split: its share of showings and clicks, its price per click and its leads per click, relative. */
interface Weighted {
  segment: string;
  w: number;
  price: number;
  f: number;
}

/** Devices under the marks and adjustments: shares follow the bid, the price half as much, as on the market. */
const deviceWeights = (market: PeriodMarket, adjustments: DeviceAdjustments): Weighted[] =>
  DEVICES.map((device) => {
    const percent = adjustmentOf(device, adjustments);
    return {
      segment: device,
      w: DEFAULT_DEVICES[device].share * impressionMultiplier(percent),
      price: priceMultiplier(percent),
      f: market.phonesWorse && device === "mobile" ? PHONE_LEAD_FACTOR : 1,
    };
  });

/**
 * Search queries: the key phrases in equal shares and, when marked, the junk query with a quarter and no leads. A
 * query a negative phrase matches is not shown. Network ads have no queries.
 */
const queryWeights = (market: PeriodMarket, traffic: DirectionTraffic): Weighted[] => {
  const keys = [...new Map(traffic.keywords.map((k) => [phraseWords(k).join(" "), k])).values()];
  if (keys.length === 0) return [];
  const junk = market.junkQuery ? (traffic.junkQuery ?? null) : null;
  const shown = (query: string) => !traffic.negativeKeywords.some((phrase) => phraseMatches(phrase, query));
  const base = junk === null ? 1 : 1 - JUNK_SHARE;
  const rows: Weighted[] = keys.map((segment) => ({ segment, w: shown(segment) ? base / keys.length : 0, price: 1, f: 1 }));
  if (junk !== null) rows.push({ segment: junk, w: shown(junk) ? JUNK_SHARE : 0, price: 1, f: 0 });
  return rows;
};

/** Whole units of `total` by the weights, the ties of the remainders taken from `offset` on. */
const allocateFrom = (total: number, weights: readonly number[], offset: number): number[] => {
  const n = weights.length;
  if (n === 0) return [];
  const turn = ((offset % n) + n) % n;
  const rotated = [...weights.slice(turn), ...weights.slice(0, turn)];
  const shares = allocate(total, rotated);
  return weights.map((_, i) => shares[(i - turn + n) % n] ?? 0);
};

/** Moves units of `child` above `parent` to rows with room, the heaviest first, e.g. leads under clicks. */
const fitRows = (child: number[], parent: readonly number[], order: readonly number[]): void => {
  for (let i = 0; i < child.length; i++) {
    while ((child[i] ?? 0) > (parent[i] ?? 0)) {
      const to = order.find((j) => (child[j] ?? 0) < (parent[j] ?? 0));
      if (to === undefined) return;
      child[i] = (child[i] ?? 0) - 1;
      child[to] = (child[to] ?? 0) + 1;
    }
  }
};

/** Integer rows of one dimension: each metric adds up to the totals; leads ≤ clicks ≤ showings, spend only with clicks. */
const splitBy = (segments: readonly Weighted[], totals: Omit<SegmentRow, "segment">, offset: number): SegmentRow[] => {
  const shown = segments.filter((s) => s.w > 0);
  if (shown.length === 0) return [];
  const byWeight = shown.map((_, i) => i).sort((a, b) => (shown[b]?.w ?? 0) - (shown[a]?.w ?? 0));
  const impressions = allocateFrom(totals.impressions, shown.map((s) => s.w), offset);
  const clicks = allocateFrom(totals.clicks, shown.map((s) => s.w), offset);
  fitRows(clicks, impressions, byWeight);
  const leadRows = byWeight.filter((i) => (shown[i]?.f ?? 0) > 0);
  const leads = allocateFrom(totals.leads, shown.map((s) => s.w * s.f), offset);
  // Leads first move to rows that bring leads at all; only past them to any row with clicks.
  fitRows(leads, clicks, leadRows);
  fitRows(leads, clicks, byWeight);
  const spend = allocateFrom(totals.spend, shown.map((s, i) => ((clicks[i] ?? 0) > 0 ? s.w * s.price : 0)), offset);
  return shown.map((s, i) => ({ segment: s.segment, impressions: impressions[i] ?? 0, clicks: clicks[i] ?? 0, leads: leads[i] ?? 0, spend: spend[i] ?? 0 }));
};

/** A stable turn for the ties of a period's remainders, so that they do not always go to the same segment. */
const turnOf = (key: string): number => Math.floor(unit(key) * 1_000_000);

/**
 * The breakdown of one ad's numbers over a period (simulation-mode «Статистика периода от владельца»): by device and,
 * for search, by query, under the period's marks and the direction's negative phrases and adjustments at its start.
 * Money in kopecks. The same numbers, marks and settings give the same rows.
 */
export const splitPeriod = (
  traffic: DirectionTraffic,
  market: PeriodMarket,
  totals: Omit<SegmentRow, "segment">,
  key: { from: LocalDate; adId: string },
): PeriodSegments => {
  const offset = turnOf(`${key.from}|${key.adId}`);
  return {
    device: splitBy(deviceWeights(market, traffic.deviceAdjustments), totals, offset),
    query: splitBy(queryWeights(market, traffic), totals, offset),
  };
};

/**
 * How the marks and settings move an ad's leads per click and price per click against an even market (design decision
 * 5): `lead` — the share of clicks that bring leads as often as the best segment does, `price` — the mean click price.
 */
export const marketFactors = (market: PeriodMarket, traffic: DirectionTraffic): { lead: number; price: number } => {
  const mean = (rows: readonly Weighted[], value: (r: Weighted) => number) => {
    const total = rows.reduce((s, r) => s + r.w, 0);
    return total > 0 ? rows.reduce((s, r) => s + r.w * value(r), 0) / total : 1;
  };
  const devices = deviceWeights(market, traffic.deviceAdjustments);
  const queries = queryWeights(market, traffic);
  return { lead: mean(devices, (r) => r.f) * mean(queries, (r) => r.f), price: mean(devices, (r) => r.price) };
};

/** The lines under a direction: what the marks mean for the numbers entered now (design decision 8). */
export const marketLines = (direction: PeriodFormDirection, market: PeriodMarket, ads: readonly PeriodAdInput[], from: LocalDate): string[] => {
  const own = new Set(direction.ads.map((a) => a.id));
  const rows = ads.filter((a) => own.has(a.adId));
  const spendRub = rows.reduce((s, a) => s + a.spendRub, 0);
  const lines: string[] = [];
  const junk = direction.junkQuery;
  if (market.junkQuery && junk !== null) {
    if (direction.negativeKeywords.some((phrase) => phraseMatches(phrase, junk))) {
      lines.push(`Реклама уже не показывается по запросу «${junk}»`);
    } else if (spendRub > 0) {
      const kopecks = rows.reduce((s, a) => {
        const split = splitPeriod(direction, market, { impressions: a.impressions, clicks: a.clicks, leads: a.leads, spend: a.spendRub * 100 }, { from, adId: a.adId });
        return s + (split.query.find((r) => r.segment === junk)?.spend ?? 0);
      }, 0);
      lines.push(`Около ${rub(Math.round(kopecks / 1_000) * 10)} из ${rub(spendRub)} — на запрос «${junk}», без обращений`);
    }
  }
  if (market.phonesWorse && spendRub > 0) lines.push("С телефонов обращение выйдет примерно вчетверо дороже, чем с компьютера");
  return lines;
};

/** A stable number in [0, 1) for a key: the same window gives the same numbers, different ads different ones. */
const unit = (key: string): number => {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
};
const between = (key: string, low: number, high: number): number => low + unit(key) * (high - low);

/** What a click costs and how often a showing is clicked when an ad has no past period, by channel (in rubles). */
const TYPICAL: Record<Channel, { cpc: [number, number]; ctr: [number, number] }> = {
  search: { cpc: [30, 60], ctr: [0.04, 0.08] },
  network: { cpc: [12, 24], ctr: [0.005, 0.01] },
};

/**
 * «Заполнить примерно» (simulation-mode spec «Статистика периода от владельца»): plausible numbers for every ad of the
 * window. A direction spends about 70% of its room, shared by the ads' spend a day in their last period (or evenly);
 * an ad keeps its last price per click, click rate and lead rate, and an ad without a last period gets the channel's
 * usual ones with a lead rate of its own. Lead rate and click price follow what changed since the last period in the
 * marks, negative phrases and adjustments (simulation-breakdowns decision 5): a junk query taken away makes leads more
 * frequent. Deterministic for the same window, period and marks, and always within its checks.
 */
export const suggestPeriod = (form: PeriodForm, days: PeriodDays, market: PeriodMarket = form.market): PeriodAdInput[] =>
  form.directions.flatMap((direction) => {
    const budget = Math.floor(direction.roomRub[days] * 0.7);
    const typical = TYPICAL[direction.channel];
    const now = marketFactors(market, direction);
    // A period saved before simulation-breakdowns counts as even: no marks, no negative phrases, no adjustments.
    const before = (last: PeriodAdLast) =>
      marketFactors(last.market ?? NO_MARKET, last.traffic ?? { keywords: direction.keywords, negativeKeywords: [], deviceAdjustments: NEUTRAL_ADJUSTMENTS });
    const weights = direction.ads.map((ad) => {
      const base = ad.last !== undefined && ad.last.spendRub > 0 ? ad.last.spendRub / ad.last.days : 1;
      return base * between(`${ad.id}|${form.from}|${days}|share`, 0.8, 1.2);
    });
    const total = weights.reduce((s, w) => s + w, 0);
    return direction.ads.map((ad, i): PeriodAdInput => {
      const share = total > 0 ? Math.floor((budget * (weights[i] ?? 0)) / total) : 0;
      const last = ad.last !== undefined && ad.last.clicks > 0 && ad.last.impressions > 0 ? ad.last : undefined;
      const was = last ? before(last) : { lead: 1, price: 1 };
      const cpc = Math.max(1, (last ? last.spendRub / last.clicks : between(`${ad.id}|cpc`, ...typical.cpc)) * (now.price / was.price));
      const ctr = last ? last.clicks / last.impressions : between(`${ad.id}|ctr`, ...typical.ctr);
      const cr = Math.min(
        1,
        (last ? (last.leads / last.clicks) * between(`${ad.id}|${form.from}|${days}|cr`, 0.85, 1.15) : between(`${ad.id}|cr`, 0.02, 0.12)) * (now.lead / (was.lead || 1)),
      );
      // The whole share is spent: the price per click is the share over the clicks it buys, close to `cpc`.
      const clicks = Math.round(share / cpc);
      if (clicks === 0) return { adId: ad.id, impressions: 0, clicks: 0, leads: 0, spendRub: 0 };
      const spendRub = share;
      const impressions = Math.max(clicks, Math.round(clicks / Math.max(ctr, 0.0001)));
      const leads = Math.min(clicks, Math.round(clicks * cr));
      return { adId: ad.id, impressions, clicks, leads, spendRub };
    });
  });
