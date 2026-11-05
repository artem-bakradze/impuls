import { addDays, toLocalDate } from "@impuls/core";
import type { Channel, Kopecks, LocalDate } from "@impuls/core";
import type { SimulatorState } from "@impuls/platforms";

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

/** An ad's numbers in the last period the owner entered for it, with that period's length. */
export interface PeriodAdLast {
  days: number;
  impressions: number;
  clicks: number;
  leads: number;
  spendRub: number;
}

export interface PeriodFormDirection {
  id: string;
  name: string;
  channel: Channel;
  ads: { id: string; title: string; last?: PeriodAdLast }[];
  /** What Direct would spend on the direction at most over each period from the current day, in whole rubles. */
  roomRub: Record<PeriodDays, number>;
}

/** The window: the ads shown now by direction, from the current day of the simulation. */
export interface PeriodForm {
  /** The current day's date: every period starts on it. */
  from: LocalDate;
  directions: PeriodFormDirection[];
}

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
 * of a campaign on each date (`campaignRoom` of `@impuls/platforms`).
 */
export const periodForm = (input: {
  state: Pick<SimulatorState, "campaigns" | "ads">;
  room: (platformCampaignId: string, dates: readonly LocalDate[]) => Kopecks[];
  directions: readonly { id: string; name: string; channel: Channel; platformCampaignId: string }[];
  ads: readonly { id: string; title: string; directionId: string; platformAdId: string }[];
  start: Date;
  timeZone: string;
  /** The ads' last entered numbers, for «Заполнить примерно». */
  last?: ReadonlyMap<string, PeriodAdLast>;
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
        const last = input.last?.get(a.id);
        return last === undefined ? { id: a.id, title: a.title } : { id: a.id, title: a.title, last };
      });
    if (ads.length === 0) continue;
    const room = (days: PeriodDays) =>
      Math.floor(input.room(direction.platformCampaignId, periodDates(input.start, days, input.timeZone)).reduce((s, r) => s + r, 0) / 100);
    directions.push({ id: direction.id, name: direction.name, channel: direction.channel, ads, roomRub: { 1: room(1), 3: room(3), 7: room(7), 14: room(14) } });
  }
  return { from: toLocalDate(input.start, input.timeZone), directions };
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

/** The last non-zero numbers of every ad in the owner's completed periods, from the saved steps. */
export const lastEntered = (steps: readonly { kind: string; state?: string | undefined; days?: number | undefined; input?: readonly PeriodAdInput[] | undefined }[]): Map<string, PeriodAdLast> => {
  const last = new Map<string, PeriodAdLast>();
  for (const step of steps) {
    if (step.kind !== "period" || step.state !== "completed" || step.days === undefined) continue;
    for (const row of step.input ?? []) {
      if (row.impressions + row.clicks + row.leads + row.spendRub === 0) continue;
      last.set(row.adId, { days: step.days, impressions: row.impressions, clicks: row.clicks, leads: row.leads, spendRub: row.spendRub });
    }
  }
  return last;
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
 * usual ones with a lead rate of its own. Deterministic for the same window and period, and always within its checks.
 */
export const suggestPeriod = (form: PeriodForm, days: PeriodDays): PeriodAdInput[] =>
  form.directions.flatMap((direction) => {
    const budget = Math.floor(direction.roomRub[days] * 0.7);
    const typical = TYPICAL[direction.channel];
    const weights = direction.ads.map((ad) => {
      const base = ad.last !== undefined && ad.last.spendRub > 0 ? ad.last.spendRub / ad.last.days : 1;
      return base * between(`${ad.id}|${form.from}|${days}|share`, 0.8, 1.2);
    });
    const total = weights.reduce((s, w) => s + w, 0);
    return direction.ads.map((ad, i): PeriodAdInput => {
      const share = total > 0 ? Math.floor((budget * (weights[i] ?? 0)) / total) : 0;
      const last = ad.last !== undefined && ad.last.clicks > 0 && ad.last.impressions > 0 ? ad.last : undefined;
      const cpc = Math.max(1, last ? last.spendRub / last.clicks : between(`${ad.id}|cpc`, ...typical.cpc));
      const ctr = last ? last.clicks / last.impressions : between(`${ad.id}|ctr`, ...typical.ctr);
      const cr = last ? (last.leads / last.clicks) * between(`${ad.id}|${form.from}|${days}|cr`, 0.85, 1.15) : between(`${ad.id}|cr`, 0.02, 0.12);
      // The whole share is spent: the price per click is the share over the clicks it buys, close to `cpc`.
      const clicks = Math.round(share / cpc);
      if (clicks === 0) return { adId: ad.id, impressions: 0, clicks: 0, leads: 0, spendRub: 0 };
      const spendRub = share;
      const impressions = Math.max(clicks, Math.round(clicks / Math.max(ctr, 0.0001)));
      const leads = Math.min(clicks, Math.round(clicks * cr));
      return { adId: ad.id, impressions, clicks, leads, spendRub };
    });
  });
